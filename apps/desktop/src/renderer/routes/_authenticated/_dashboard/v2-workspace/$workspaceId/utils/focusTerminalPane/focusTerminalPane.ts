import type { WorkspaceState, WorkspaceStore } from "@superset/panes";
import type { StoreApi } from "zustand/vanilla";
import type { TerminalLauncher } from "../../hooks/useV2TerminalLauncher";
import type { PaneViewerData, TerminalPaneData } from "../../types";

interface TerminalPaneLocation {
	tabId: string;
	paneId: string;
}

export type FocusOrAddTerminalPaneResult = "focused" | "added";

export function findTerminalPaneLocation(
	state: WorkspaceState<PaneViewerData>,
	terminalId: string,
): TerminalPaneLocation | null {
	for (const tab of state.tabs) {
		for (const pane of Object.values(tab.panes)) {
			if (pane.kind !== "terminal") continue;
			const data = pane.data as Partial<TerminalPaneData>;
			if (data.terminalId !== terminalId) continue;
			return { tabId: tab.id, paneId: pane.id };
		}
	}

	return null;
}

export function focusTerminalPane(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
	terminalId: string,
): boolean {
	const state = store.getState();
	const location = findTerminalPaneLocation(state, terminalId);
	if (!location) return false;

	state.setActiveTab(location.tabId);
	state.setActivePane(location);
	return true;
}

export function focusOrAddTerminalPane(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
	terminalId: string,
): FocusOrAddTerminalPaneResult {
	if (focusTerminalPane(store, terminalId)) return "focused";

	store.getState().addTab({
		panes: [
			{
				kind: "terminal",
				data: { terminalId } as PaneViewerData,
			},
		],
	});
	return "added";
}

export type OpenTerminalPaneResult = "focused" | "created";

/**
 * Open an agent by its terminal id. If a pane already displays it the agent is
 * in the foreground — just focus it (current pattern). Otherwise it's running
 * in the background with no pane attached, so create/adopt the terminal via the
 * launcher (idempotent `createSession`) before adding the pane, so the pane's
 * WebSocket connect doesn't race ahead of the session existing on host-service.
 */
export async function focusOrCreateTerminalPane(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
	terminalId: string,
	launcher: TerminalLauncher,
): Promise<OpenTerminalPaneResult> {
	if (focusTerminalPane(store, terminalId)) return "focused";

	await launcher.create({ terminalId });

	// A pane may have appeared while we awaited (e.g. auto-adopt); re-check
	// before adding so we never leave a duplicate terminal pane behind.
	if (focusTerminalPane(store, terminalId)) return "focused";

	store.getState().addTab({
		panes: [
			{
				kind: "terminal",
				data: { terminalId } as PaneViewerData,
			},
		],
	});
	return "created";
}
