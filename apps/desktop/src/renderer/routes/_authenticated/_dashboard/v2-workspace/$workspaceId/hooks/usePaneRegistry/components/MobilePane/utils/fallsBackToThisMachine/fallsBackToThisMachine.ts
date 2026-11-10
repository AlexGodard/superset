interface WorkspaceHostAnswer {
	/** What the workspace's host can show a Mobile pane with; undefined until it answers. */
	backend: string | undefined;
	unreachable: boolean;
	/** The pane is already asking this machine's host service. */
	onThisMachine: boolean;
}

/**
 * Self-built fork: a workspace whose host has no simulator to offer (a Linux
 * box), or cannot be asked, gets the ones on the machine the app runs on.
 */
export function fallsBackToThisMachine({
	backend,
	unreachable,
	onThisMachine,
}: WorkspaceHostAnswer): boolean {
	if (onThisMachine) return false;
	return backend === "none" || unreachable;
}
