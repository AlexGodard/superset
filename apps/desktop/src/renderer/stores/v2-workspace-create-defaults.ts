import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type V2WorkspaceCreateBaseBranchSource = "local" | "remote-tracking";

export interface V2WorkspaceCreateBaseBranchDefault {
	branchName: string;
	source: V2WorkspaceCreateBaseBranchSource;
}

interface V2WorkspaceCreateDefaultsState {
	lastProjectId: string | null;
	baseBranchesByProjectId: Record<string, V2WorkspaceCreateBaseBranchDefault>;
	lastHostId: string | null;
	/**
	 * Let the host ranker pick the host. On by default: a host picked by hand
	 * is that one workspace's (the draft's autoHostDeclined), and lastHostId
	 * keeps it for the surfaces that read it.
	 */
	autoHost: boolean;
	/** User closed the sample-prompt suggestions on the create surface. */
	samplePromptsDismissed: boolean;

	setLastProjectId: (projectId: string | null) => void;
	setBaseBranchDefault: (
		projectId: string,
		branchName: string,
		source: V2WorkspaceCreateBaseBranchSource,
	) => void;
	clearBaseBranchDefault: (projectId: string) => void;
	setLastHostId: (hostId: string | null) => void;
	setAutoHost: (autoHost: boolean) => void;
	setSamplePromptsDismissed: (dismissed: boolean) => void;
}

export const useV2WorkspaceCreateDefaultsStore =
	create<V2WorkspaceCreateDefaultsState>()(
		devtools(
			persist(
				(set) => ({
					lastProjectId: null,
					baseBranchesByProjectId: {},
					lastHostId: null,
					autoHost: true,
					samplePromptsDismissed: false,

					setLastProjectId: (projectId) => set({ lastProjectId: projectId }),

					setBaseBranchDefault: (projectId, branchName, source) => {
						const trimmed = branchName.trim();
						if (!trimmed) return;
						set((state) => ({
							baseBranchesByProjectId: {
								...state.baseBranchesByProjectId,
								[projectId]: { branchName: trimmed, source },
							},
						}));
					},

					clearBaseBranchDefault: (projectId) =>
						set((state) => {
							if (!(projectId in state.baseBranchesByProjectId)) return state;
							const next = { ...state.baseBranchesByProjectId };
							delete next[projectId];
							return { baseBranchesByProjectId: next };
						}),

					setLastHostId: (hostId) => set({ lastHostId: hostId }),

					setAutoHost: (autoHost) => set({ autoHost }),

					setSamplePromptsDismissed: (dismissed) =>
						set({ samplePromptsDismissed: dismissed }),
				}),
				{
					name: "v2-workspace-create-defaults",
					version: 3,
					migrate: (state, fromVersion) => {
						if (!state || typeof state !== "object") return state;
						let next = state as Record<string, unknown>;
						if (fromVersion < 2) {
							const oldTarget = next.lastHostTarget as
								| { kind: "local" }
								| { kind: "host"; hostId: string }
								| null
								| undefined;
							const lastHostId =
								oldTarget && oldTarget.kind === "host"
									? oldTarget.hostId
									: null;
							const { lastHostTarget: _omit, ...rest } = next;
							next = { ...rest, lastHostId };
						}
						// Version 3 made Auto the default; a manual pick no longer turns it off.
						if (fromVersion < 3) next = { ...next, autoHost: true };
						return next;
					},
				},
			),
			{ name: "V2WorkspaceCreateDefaultsStore" },
		),
	);
