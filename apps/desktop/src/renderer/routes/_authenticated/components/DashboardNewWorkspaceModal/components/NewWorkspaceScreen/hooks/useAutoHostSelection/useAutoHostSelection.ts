import { useLingui } from "@lingui/react/macro";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHostUrls } from "renderer/hooks/host-service/useHostTargetUrl";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { hostProjectIdsQueryOptions } from "renderer/react-query/projects";
import { useNewWorkspaceDraftStore } from "renderer/stores/new-workspace-draft";
import { useV2WorkspaceCreateDefaultsStore } from "renderer/stores/v2-workspace-create-defaults";
import { type HostProjectState, pickAutoHost } from "../../utils/pickAutoHost";

const RANK_STALE_MS = 30_000;

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

	const available = ranked !== null;
	const active = autoHost && available && !overridden;
	const key = `${projectId ?? ""}|${isSession}`;

	const rankedIds = useMemo(
		() => (ranked ?? []).map((host) => host.machineId),
		[ranked],
	);
	const hostUrls = useHostUrls(rankedIds);
	const projectQueries = useQueries({
		queries: hostUrls.map(({ url }) => ({
			...hostProjectIdsQueryOptions(url),
			enabled: active && !isSession && !!url,
		})),
	});

	const pick = useMemo(() => {
		if (!active || ranked === undefined || !hostsSettled) {
			return { status: "pending" } as const;
		}
		if (!isSession && !projectId) return { status: "pending" } as const;
		const projectState = (id: string): HostProjectState => {
			if (isSession) return "present";
			const index = rankedIds.indexOf(id);
			const query = projectQueries[index];
			if (!hostUrls[index]?.url || !query) return "absent";
			if (query.data === undefined) return "pending";
			return query.data?.has(projectId ?? "") ? "present" : "absent";
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
		machineId,
		localHostIsReachable,
		otherHosts,
	]);

	const [applied, setApplied] = useState<AppliedPick | null>(null);
	useEffect(() => {
		if (!active || pick.status === "pending" || applied?.key === key) return;
		const next =
			pick.status === "picked"
				? { key, machineId: pick.machineId, reason: pick.reason }
				: machineId
					? {
							key,
							machineId,
							reason: t({ message: "No ranked host fits; using this device" }),
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
		setApplied(null);
	}, [setAutoHost]);

	const deselect = useCallback(() => setAutoHost(false), [setAutoHost]);

	/** Runs the create, then reports the placement if it went where Auto chose. */
	const submitAndReportPlacement = useCallback(
		async (submit: () => Promise<void>) => {
			const placed =
				active && applied?.key === key && applied.machineId === hostId
					? applied.machineId
					: null;
			const resetKeyBefore = useNewWorkspaceDraftStore.getState().resetKey;
			await submit();
			if (!placed) return;
			if (useNewWorkspaceDraftStore.getState().resetKey === resetKeyBefore)
				return;
			void electronTrpcClient.hostRanking.placed
				.mutate({ machineId: placed })
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
