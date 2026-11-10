import { win32 } from "node:path";
import {
	allLayoutTabs,
	type PaneLayoutOpResult,
	type SidebarTool,
} from "@superset/shared/pane-layout-ops";
import { TRPCError } from "@trpc/server";
import { PaneLayoutBridgeClient } from "../../../runtime/pane-layout-bridge/pane-layout-bridge-client";
import type { HostServiceContext } from "../../../types";
import { getLocalWorkspace } from "../../../workspaces/local-workspace-store";

// The desktop app keeps a pane layout for every workspace it shows, on
// whichever host the workspace lives, and only the host service the app
// spawned can reach that layout. So an op that changes nothing but the layout
// takes any workspace, and the app answers for one it does not know. An op
// that needs this machine (a terminal or chat session, the worktree) still
// takes only a workspace of this host.

type WorkspaceLookup = Pick<HostServiceContext, "db">;

export function isOnThisHost(
	ctx: WorkspaceLookup,
	workspaceId: string,
): boolean {
	return getLocalWorkspace(ctx.db, workspaceId) !== undefined;
}

function onAnotherHost(workspaceId: string, consequence: string): string {
	return `Workspace ${workspaceId} lives on another host (this one has no such workspace): ${consequence}`;
}

/** `split` and `newTab` show a terminal or chat session, which they look up on this host. */
export function requireSessionsOnThisHost(
	ctx: WorkspaceLookup,
	workspaceId: string,
): void {
	if (isOnThisHost(ctx, workspaceId)) return;
	throw new TRPCError({
		code: "NOT_FOUND",
		message: onAnotherHost(
			workspaceId,
			"its terminals and chats run there, so this host cannot open one in a pane.",
		),
	});
}

/** `close` ends the pane's terminal, which only the terminal's host can do. */
export function requireTerminalOnThisHost(
	ctx: WorkspaceLookup,
	workspaceId: string,
	terminalId: string,
): void {
	if (isOnThisHost(ctx, workspaceId)) return;
	throw new TRPCError({
		code: "NOT_FOUND",
		message: onAnotherHost(
			workspaceId,
			`terminal ${terminalId} runs there, so this host cannot end it. Close the pane with --keep-terminal to leave it running.`,
		),
	});
}

/**
 * `open` turns a path into the form its pane takes, absolute for the editor
 * and relative to the worktree for Changes, and checks it against the
 * worktree. A workspace of another host has no worktree here, so its path
 * must come in that form already; its own host refuses a file outside the
 * worktree when the pane reads it.
 */
export function requireOpenPathAsGiven(
	ctx: WorkspaceLookup,
	workspaceId: string,
	tool: SidebarTool,
	path: string | undefined,
): void {
	if (!path || isOnThisHost(ctx, workspaceId)) return;
	// The other host may run Windows; win32 also reads a leading slash as absolute.
	const absolute = win32.isAbsolute(path);
	if (tool === "file" && !absolute) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: onAnotherHost(
				workspaceId,
				`this host cannot resolve ${path} against its worktree. Pass the file's absolute path on that host.`,
			),
		});
	}
	if (tool === "changes" && absolute) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: onAnotherHost(
				workspaceId,
				`this host cannot make ${path} relative to its worktree. Pass the path relative to the worktree.`,
			),
		});
	}
}

function listPanesInApp(
	ctx: Pick<HostServiceContext, "browserBridge">,
	workspaceId: string,
): Promise<PaneLayoutOpResult> {
	if (!ctx.browserBridge) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "No desktop app is attached to this host.",
		});
	}
	return new PaneLayoutBridgeClient(ctx.browserBridge).apply({
		workspaceId,
		op: { type: "list" },
	});
}

/**
 * `browser.open` has the app file a workspace it has never shown under the
 * workspace's project, which only the workspace's host knows. Given none, the
 * app files the workspace under no project and leaves it there. So a
 * workspace of another host opens a browser only once the app has panes for
 * it, which means it has filed it already.
 */
export async function requirePanesInApp(
	ctx: Pick<HostServiceContext, "browserBridge">,
	workspaceId: string,
	list: typeof listPanesInApp = listPanesInApp,
): Promise<void> {
	const { layout } = await list(ctx, workspaceId);
	if (allLayoutTabs(layout).length > 0) return;
	throw new TRPCError({
		code: "PRECONDITION_FAILED",
		message: onAnotherHost(
			workspaceId,
			"the desktop app has no panes for it yet, and this host cannot tell the app which project it belongs to. Open the workspace in the app, or run `superset panes open browser --url <url>`.",
		),
	});
}
