import { useLingui } from "@lingui/react/macro";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHostUrls } from "renderer/hooks/host-service/useHostTargetUrl";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useNewWorkspaceDraftStore } from "renderer/stores/new-workspace-draft";
import { useV2WorkspaceCreateDefaultsStore } from "renderer/stores/v2-workspace-create-defaults";
import {
	type HostProjectState,
	hostProjectState,
	pickAutoHost,
	type SkippedHost,
} from "../../utils/pickAutoHost";

const RANK_STALE_MS = 30_000;
// How long a better-ranked host's project list may take, retries included,
// before Auto passes it over as unreachable.
const PROJECT_LIST_DEADLINE_MS = 8_000;

interface UseAutoHostSelectionOptions {
	projectId: string | null;
	isSession: boolean;
	hostId: string | null;
	machineId: string | null;
	localHostIsReachable: boolean;
	otherHosts: ReadonlyArray<{ id: string; isOnline: boolean }>;
	hostsSettled: boolean;
	/** A host named in the URL wins over Auto for this visit. */
	preSelectedHostId: string | null;
	updateDraft: (patch: { hostId: string }) => void;
}

interface AppliedPick {
	key: string;
	machineId: string;
	reason: string;
	skipped: SkippedHost[];
}

export function useAutoHostSelection({
	projectId,
	isSession,
	hostId,
	machineId,
	localHostIsReachable,
	otherHosts,
	hostsSettled,
	preSelectedHostId,
	updateDraft,
}: UseAutoHostSelectionOptions) {
	const { t } = useLingui();
	const autoHost = useV2WorkspaceCreateDefaultsStore((state) => state.autoHost);
	const setAutoHost = useV2WorkspaceCreateDefaultsStore(
		(state) => state.setAutoHost,
	);
	const utils = electronTrpc.useUtils();
	const rankQuery = electronTrpc.hostRanking.rank.useQuery(undefined, {
		staleTime: RANK_STALE_MS,
	});
	const ranked = rankQuery.isError ? [] : rankQuery.data;

	const [overridden, setOverridden] = useState(preSelectedHostId !== null);
	useEffect(() => {
		if (preSelectedHostId) setOverridden(true);
	}, [preSelectedHostId]);

	// A host picked by hand in this draft wins over Auto for this workspace only.
	const declined = useNewWorkspaceDraftStore((state) => state.autoHostDeclined);
	// The create surface stays mounted across creates: each new draft picks again.
	const resetKey = useNewWorkspaceDraftStore((state) => state.resetKey);
	const available = ranked !== null;
	const active = autoHost && available && !overridden && !declined;
	const key = `${projectId ?? ""}|${isSession}|${resetKey}`;

	const rankedIds = useMemo(
		() => (ranked ?? []).map((host) => host.machineId),
		[ranked],
	);
	const hostUrls = useHostUrls(rankedIds);
	// Fetched for each draft, not read from the shared project list: that one
	// stores a failed fetch as "no projects" and can be hours old, and the pick
	// is final once made. A failure here throws, so the client's retry rides
	// out a relay blip.
	const projectQueries = useQueries({
		queries: hostUrls.map(({ url }) => ({
			queryKey: ["auto-host", "project-ids", url, key] as const,
			enabled: active && !isSession && !!url,
			gcTime: 0,
			queryFn: async () => {
				if (!url) throw new Error("no route to host");
				const rows = await getHostServiceClientByUrl(url).project.list.query();
				return new Set(rows.map((row) => row.id));
			},
		})),
	});

	const [applied, setApplied] = useState<AppliedPick | null>(null);
	const waitingForProjects =
		active && ranked !== undefined && hostsSettled && applied?.key !== key;
	const [timedOutKey, setTimedOutKey] = useState<string | null>(null);
	useEffect(() => {
		if (!waitingForProjects) return;
		const timer = setTimeout(
			() => setTimedOutKey(key),
			PROJECT_LIST_DEADLINE_MS,
		);
		return () => clearTimeout(timer);
	}, [waitingForProjects, key]);
	const timedOut = timedOutKey === key;

	const pick = useMemo(() => {
		if (!active || ranked === undefined || !hostsSettled) {
			return { status: "pending" } as const;
		}
		if (!isSession && !projectId) return { status: "pending" } as const;
		const projectState = (id: string): HostProjectState => {
			if (isSession) return "present";
			const index = rankedIds.indexOf(id);
			const query = projectQueries[index];
			if (!hostUrls[index]?.url || !query) return "unreachable";
			return hostProjectState({
				projectIds: query.data,
				failed: query.isError,
				timedOut,
				projectId: projectId ?? "",
			});
		};
		const isOnline = (id: string) =>
			id === machineId
				? localHostIsReachable
				: (otherHosts.find((host) => host.id === id)?.isOnline ?? false);
		return pickAutoHost({ ranked, isOnline, projectState });
	}, [
		active,
		ranked,
		hostsSettled,
		isSession,
		projectId,
		rankedIds,
		projectQueries,
		hostUrls,
		timedOut,
		machineId,
		localHostIsReachable,
		otherHosts,
	]);

	useEffect(() => {
		if (!active || pick.status === "pending" || applied?.key === key) return;
		const next =
			pick.status === "picked"
				? {
						key,
						machineId: pick.machineId,
						reason: pick.reason,
						skipped: pick.skipped,
					}
				: machineId
					? {
							key,
							machineId,
							reason: t({ message: "No ranked host fits; using this device" }),
							skipped: pick.skipped,
						}
					: null;
		if (!next) return;
		setApplied(next);
		// Unconditional: the last-used host restore can land in the same commit.
		updateDraft({ hostId: next.machineId });
	}, [active, pick, applied, key, machineId, updateDraft, t]);

	const isResolving = active && applied?.key !== key;

	const select = useCallback(() => {
		setAutoHost(true);
		setOverridden(false);
		useNewWorkspaceDraftStore.setState({ autoHostDeclined: false });
		setApplied(null);
	}, [setAutoHost]);

	const deselect = useCallback(
		() => useNewWorkspaceDraftStore.setState({ autoHostDeclined: true }),
		[],
	);

	/**
	 * Runs the create, then reports the placement if it went where Auto chose,
	 * with the hosts Auto passed over, for the ranker's log.
	 */
	const submitAndReportPlacement = useCallback(
		async (submit: () => Promise<void>) => {
			const placed =
				active && applied?.key === key && applied.machineId === hostId
					? applied
					: null;
			const resetKeyBefore = useNewWorkspaceDraftStore.getState().resetKey;
			await submit();
			if (!placed) return;
			if (useNewWorkspaceDraftStore.getState().resetKey === resetKeyBefore)
				return;
			void electronTrpcClient.hostRanking.placed
				.mutate({ machineId: placed.machineId, skipped: placed.skipped })
				.catch(() => false)
				.finally(() => utils.hostRanking.rank.reset());
		},
		[active, applied, key, hostId, utils],
	);

	return {
		available,
		active,
		isResolving,
		reason: active && applied?.key === key ? applied.reason : null,
		select,
		deselect,
		submitAndReportPlacement,
	};
}
