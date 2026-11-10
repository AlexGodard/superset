import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
	PaneLayoutOpResult,
	PaneLayoutPane,
	PaneLayoutSnapshot,
	PaneLayoutTab,
} from "@superset/shared/pane-layout-ops";
import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../../../types";
import { browserRouter } from "../browser/browser";
import { panesRouter } from "./panes";
import {
	isOnThisHost,
	requireOpenPathAsGiven,
	requirePanesInApp,
	requireSessionsOnThisHost,
	requireTerminalOnThisHost,
} from "./workspace-on-another-host";

const WS = "ws-1";
const ON_ANOTHER_HOST =
	"Workspace ws-1 lives on another host (this one has no such workspace): ";

/** A host whose workspace lookup finds `WS`, or finds nothing. */
function hostWhere(workspace: "is here" | "is elsewhere"): HostServiceContext {
	const row =
		workspace === "is here"
			? { id: WS, projectId: "project-1", worktreePath: "/repo" }
			: undefined;
	return {
		isAuthenticated: true,
		browserBridge: { url: "http://127.0.0.1:9", secret: "secret" },
		db: {
			query: { workspaces: { findFirst: () => ({ sync: () => row }) } },
		},
		terminalAgentStore: { listByWorkspace: () => [] },
	} as unknown as HostServiceContext;
}

function refusal(run: () => unknown): TRPCError {
	try {
		run();
	} catch (error) {
		if (error instanceof TRPCError) return error;
		throw error;
	}
	throw new Error("expected a refusal");
}

async function rejection(promise: Promise<unknown>): Promise<TRPCError> {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	if (error instanceof TRPCError) return error;
	throw new Error(`expected a refusal, got ${String(error)}`);
}

const chatPane: PaneLayoutPane = {
	id: "pane-chat",
	kind: "chat-v3",
	title: null,
	terminalId: "t1",
	active: true,
};

const chatTab: PaneLayoutTab = {
	id: "tab-chat",
	title: null,
	active: true,
	activePaneId: "pane-chat",
	layout: { type: "pane", paneId: "pane-chat" },
	panes: [chatPane],
};

const browserTab: PaneLayoutTab = {
	id: "tab-browser",
	title: null,
	active: true,
	activePaneId: "pane-browser",
	layout: { type: "pane", paneId: "pane-browser" },
	panes: [
		{
			id: "pane-browser",
			kind: "browser",
			title: "Docs",
			terminalId: null,
			active: true,
			browser: { url: "https://github.com/" },
		},
	],
};

function layoutOf(
	main: PaneLayoutTab[],
	sidebar: PaneLayoutTab[],
): PaneLayoutSnapshot {
	return {
		activeTabId: main[0]?.id ?? null,
		tabs: main,
		sidebar: {
			open: sidebar.length > 0,
			fullScreen: false,
			activeTabId: sidebar[0]?.id ?? null,
			tabs: sidebar,
		},
	};
}

const SHOWN = layoutOf([chatTab], [browserTab]);
const NOTHING_SHOWN = layoutOf([], []);

describe("isOnThisHost", () => {
	test("is the host's own workspace lookup", () => {
		expect(isOnThisHost(hostWhere("is here"), WS)).toBe(true);
		expect(isOnThisHost(hostWhere("is elsewhere"), WS)).toBe(false);
	});
});

describe("ops that need this machine", () => {
	test("pass for a workspace of this host", () => {
		const here = hostWhere("is here");
		requireSessionsOnThisHost(here, WS);
		requireTerminalOnThisHost(here, WS, "t1");
	});

	test("opening a terminal or chat pane says the workspace lives on another host", () => {
		const error = refusal(() =>
			requireSessionsOnThisHost(hostWhere("is elsewhere"), WS),
		);
		expect(error.code).toBe("NOT_FOUND");
		expect(error.message).toBe(
			`${ON_ANOTHER_HOST}its terminals and chats run there, so this host cannot open one in a pane.`,
		);
	});

	test("ending a pane's terminal says so too, and how to close the pane anyway", () => {
		const error = refusal(() =>
			requireTerminalOnThisHost(hostWhere("is elsewhere"), WS, "t1"),
		);
		expect(error.code).toBe("NOT_FOUND");
		expect(error.message).toBe(
			`${ON_ANOTHER_HOST}terminal t1 runs there, so this host cannot end it. Close the pane with --keep-terminal to leave it running.`,
		);
	});
});

describe("requireOpenPathAsGiven", () => {
	const elsewhere = hostWhere("is elsewhere");

	test("leaves every path of this host's workspace to the worktree check", () => {
		const here = hostWhere("is here");
		requireOpenPathAsGiven(here, WS, "file", "src/app.ts");
		requireOpenPathAsGiven(here, WS, "changes", "/repo/src/app.ts");
	});

	test("takes a path already in the form its pane shows", () => {
		requireOpenPathAsGiven(elsewhere, WS, "file", "/home/me/repo/src/app.ts");
		requireOpenPathAsGiven(elsewhere, WS, "file", "C:\\repo\\src\\app.ts");
		requireOpenPathAsGiven(elsewhere, WS, "changes", "src/app.ts");
	});

	test("takes the tools that open no path", () => {
		requireOpenPathAsGiven(elsewhere, WS, "browser", undefined);
		requireOpenPathAsGiven(elsewhere, WS, "changes", undefined);
		requireOpenPathAsGiven(elsewhere, WS, "files", undefined);
		requireOpenPathAsGiven(elsewhere, WS, "pages", undefined);
	});

	test("refuses a file path it would have to resolve against the worktree", () => {
		const error = refusal(() =>
			requireOpenPathAsGiven(elsewhere, WS, "file", "src/app.ts"),
		);
		expect(error.code).toBe("BAD_REQUEST");
		expect(error.message).toBe(
			`${ON_ANOTHER_HOST}this host cannot resolve src/app.ts against its worktree. Pass the file's absolute path on that host.`,
		);
	});

	test("refuses a Changes path it would have to make relative to the worktree", () => {
		const error = refusal(() =>
			requireOpenPathAsGiven(elsewhere, WS, "changes", "/repo/src/app.ts"),
		);
		expect(error.code).toBe("BAD_REQUEST");
		expect(error.message).toBe(
			`${ON_ANOTHER_HOST}this host cannot make /repo/src/app.ts relative to its worktree. Pass the path relative to the worktree.`,
		);
	});
});

describe("requirePanesInApp", () => {
	const ctx = hostWhere("is elsewhere");
	const appShowing =
		(layout: PaneLayoutSnapshot) => async (): Promise<PaneLayoutOpResult> => ({
			paneId: null,
			tabId: null,
			layout,
		});

	test("passes once the app has a tab for the workspace, in the main area or the sidebar", async () => {
		await requirePanesInApp(ctx, WS, appShowing(layoutOf([chatTab], [])));
		await requirePanesInApp(ctx, WS, appShowing(layoutOf([], [browserTab])));
	});

	test("refuses a workspace the app has no panes for, and names the command that asks the app", async () => {
		const error = await rejection(
			requirePanesInApp(ctx, WS, appShowing(NOTHING_SHOWN)),
		);
		expect(error.code).toBe("PRECONDITION_FAILED");
		expect(error.message).toBe(
			`${ON_ANOTHER_HOST}the desktop app has no panes for it yet, and this host cannot tell the app which project it belongs to. Open the workspace in the app, or run \`superset panes open browser --url <url>\`.`,
		);
	});

	test("passes the app's own refusal on", async () => {
		const appDown = new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"No signed-in desktop window is open to apply the layout change.",
		});
		const error = await rejection(
			requirePanesInApp(ctx, WS, async () => {
				throw appDown;
			}),
		);
		expect(error).toBe(appDown);
	});

	test("asks nothing of a host with no desktop app", async () => {
		const error = await rejection(requirePanesInApp({}, WS));
		expect(error.message).toBe("No desktop app is attached to this host.");
	});
});

// The routers, with the desktop app's bridge answered here: what reaches the
// app is the whole point, and a port that drops one of the few lines wiring
// the helpers in would otherwise pass.
describe("through the routers", () => {
	interface BridgeCall {
		path: string;
		body: {
			workspaceId?: string;
			op?: { type: string; [field: string]: unknown };
			projectId?: unknown;
		};
	}

	const realFetch = globalThis.fetch;
	let calls: BridgeCall[];
	let app: (call: BridgeCall) => { status?: number; body: unknown };

	const showing = (layout: PaneLayoutSnapshot) => (): { body: unknown } => ({
		body: { paneId: null, tabId: null, layout },
	});
	const ops = () => calls.map((call) => call.body.op?.type ?? call.path);

	beforeEach(() => {
		calls = [];
		app = showing(SHOWN);
		globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
			const call: BridgeCall = {
				path: new URL(String(url)).pathname,
				body: JSON.parse(String(init?.body ?? "{}")),
			};
			calls.push(call);
			const { status = 200, body } = app(call);
			return { ok: status < 400, status, json: async () => body };
		}) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	const panes = (workspace: "is here" | "is elsewhere") =>
		panesRouter.createCaller(hostWhere(workspace));
	const browser = (workspace: "is here" | "is elsewhere") =>
		browserRouter.createCaller(hostWhere(workspace));

	test("list gives the app's layout for a workspace of another host, as the app sent it", async () => {
		const result = await panes("is elsewhere").list({ workspaceId: WS });
		expect(result.layout).toEqual(SHOWN);
		expect(calls).toEqual([
			{ path: "/pane-layout", body: { workspaceId: WS, op: { type: "list" } } },
		]);
	});

	test("list adds what this host knows about the terminals of its own workspace", async () => {
		const result = await panes("is here").list({ workspaceId: WS });
		expect(result.layout.tabs[0]?.panes[0]).toEqual({
			...chatPane,
			terminalTitle: null,
			agent: null,
		});
	});

	test("the ops that only change the layout reach the app for a workspace of another host", async () => {
		const there = panes("is elsewhere");
		const pane = { workspaceId: WS, paneId: "pane-browser" };
		await there.focus(pane);
		await there.resize({ ...pane, ratio: 0.3 });
		await there.move({
			...pane,
			targetPaneId: "pane-chat",
			direction: "right",
		});
		await there.moveToNewTab({ ...pane, area: "sidebar" });
		await there.swap({ ...pane, withPaneId: "pane-chat" });
		await there.equalize({ workspaceId: WS });
		await there.sidebar({ workspaceId: WS, open: true });
		await there.open({
			workspaceId: WS,
			tool: "browser",
			url: "https://github.com/",
		});
		expect(ops()).toEqual([
			"focus",
			"resize",
			"move",
			"moveToNewTab",
			"swap",
			"equalize",
			"sidebar",
			"open",
		]);
	});

	test("the app answers for a workspace it does not know", async () => {
		app = () => ({
			status: 412,
			body: {
				error:
					"This workspace has no pane layout in the desktop app yet. Open it there once, then retry.",
			},
		});
		const error = await rejection(
			panes("is elsewhere").focus({ workspaceId: WS, paneId: "pane-chat" }),
		);
		expect(error.code).toBe("PRECONDITION_FAILED");
		expect(error.message).toBe(
			"This workspace has no pane layout in the desktop app yet. Open it there once, then retry.",
		);
	});

	test("open passes a file path of another host's workspace as given, and refuses one it would have to resolve", async () => {
		const there = panes("is elsewhere");
		await there.open({
			workspaceId: WS,
			tool: "file",
			path: "/home/me/repo/src/app.ts",
			line: 40,
		});
		expect(calls[0]?.body.op).toEqual({
			type: "open",
			tool: "file",
			path: "/home/me/repo/src/app.ts",
			line: 40,
		});
		const error = await rejection(
			there.open({ workspaceId: WS, tool: "file", path: "src/app.ts" }),
		);
		expect(error.code).toBe("BAD_REQUEST");
		expect(calls).toHaveLength(1);
	});

	test("split and new-tab refuse a workspace of another host before the app is asked", async () => {
		const there = panes("is elsewhere");
		const refusals = await Promise.all([
			rejection(
				there.split({
					workspaceId: WS,
					paneId: "pane-chat",
					direction: "right",
					terminalId: "t2",
				}),
			),
			rejection(there.newTab({ workspaceId: WS, terminalId: "t2" })),
			rejection(there.newTab({ workspaceId: WS, sessionId: "session-1" })),
		]);
		for (const error of refusals) {
			expect(error.code).toBe("NOT_FOUND");
			expect(error.message).toStartWith(ON_ANOTHER_HOST);
		}
		expect(calls).toEqual([]);
	});

	test("close takes a pane with no terminal", async () => {
		const result = await panes("is elsewhere").close({
			workspaceId: WS,
			paneId: "pane-browser",
		});
		expect(result.terminalId).toBeNull();
		expect(ops()).toEqual(["list", "close"]);
	});

	test("close leaves the layout alone when it cannot end the pane's terminal", async () => {
		const error = await rejection(
			panes("is elsewhere").close({ workspaceId: WS, paneId: "pane-chat" }),
		);
		expect(error.message).toBe(
			`${ON_ANOTHER_HOST}terminal t1 runs there, so this host cannot end it. Close the pane with --keep-terminal to leave it running.`,
		);
		expect(ops()).toEqual(["list"]);
	});

	test("close with keepTerminal closes the pane and ends nothing", async () => {
		const result = await panes("is elsewhere").close({
			workspaceId: WS,
			paneId: "pane-chat",
			keepTerminal: true,
		});
		expect(result.terminalId).toBe("t1");
		expect(ops()).toEqual(["list", "close"]);
	});

	test("browser.open opens in a workspace of another host the app has panes for, naming no project", async () => {
		app = (call) =>
			call.path === "/open"
				? {
						body: { paneId: "pane-new", url: "https://github.com/", title: "" },
					}
				: showing(SHOWN)();
		const result = await browser("is elsewhere").open({
			workspaceId: WS,
			url: "https://github.com/",
		});
		expect(result.paneId).toBe("pane-new");
		expect(ops()).toEqual(["list", "/open"]);
		expect(calls[1]?.body.projectId).toBeNull();
	});

	test("browser.open asks the app for nothing more when it has no panes for the workspace", async () => {
		app = showing(NOTHING_SHOWN);
		const error = await rejection(
			browser("is elsewhere").open({
				workspaceId: WS,
				url: "https://github.com/",
			}),
		);
		expect(error.code).toBe("PRECONDITION_FAILED");
		expect(error.message).toStartWith(ON_ANOTHER_HOST);
		expect(ops()).toEqual(["list"]);
	});

	test("browser.open still names the project of this host's workspace", async () => {
		app = () => ({
			body: { paneId: "pane-new", url: "https://github.com/", title: "" },
		});
		await browser("is here").open({
			workspaceId: WS,
			url: "https://github.com/",
		});
		expect(ops()).toEqual(["/open"]);
		expect(calls[0]?.body.projectId).toBe("project-1");
	});
});
