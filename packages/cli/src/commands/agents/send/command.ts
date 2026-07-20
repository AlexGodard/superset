import { CLIError, positional, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { resolveHostTarget } from "../../../lib/host-target";
import { findHostWorkspace } from "../../../lib/host-workspaces";

export default command({
	description:
		"Send an input message to a running agent session (renders live in the desktop session)",
	args: [
		positional("sessionId")
			.required()
			.desc("Terminal/agent session id (from `superset agents create`)"),
		positional("text")
			.required()
			.variadic()
			.desc("Message to inject; submitted with a trailing carriage return"),
	],
	options: {
		workspace: string().required().desc("Workspace ID"),
	},
	run: async ({ ctx, options, args }) => {
		const sessionId = args.sessionId as string;
		const text = (args.text as string[]).join(" ");

		const organizationId = ctx.config.organizationId;
		if (!organizationId) {
			throw new CLIError("No active organization", "Run: superset auth login");
		}

		// Workspace records are host-owned: resolve the id across the org's
		// reachable hosts.
		const { workspace, warnings } = await findHostWorkspace(
			{ api: ctx.api, organizationId, userJwt: ctx.bearer },
			options.workspace,
		);
		for (const warning of warnings) {
			process.stderr.write(`Warning: ${warning}\n`);
		}
		if (!workspace) {
			throw new CLIError(
				`Workspace not found on any reachable host: ${options.workspace}`,
			);
		}

		const target = resolveHostTarget({
			requestedHostId: workspace.hostId,
			organizationId,
			userJwt: ctx.bearer,
		});

		// Submit in TWO writes: the body, then a SEPARATE carriage return.
		//
		// Verified against Claude Code's TUI: a trailing \n only types a newline into
		// the input box (never submits); \r is the Enter key. But a long body with a
		// trailing \r in a SINGLE write is swallowed by the TUI's bracketed-paste
		// detection — the whole chunk is treated as a paste and the \r is absorbed as
		// literal text, so it buffers UNSUBMITTED (short single-token sends happen to
		// escape this, which masked the bug). Writing the \r as its own chunk makes it
		// an unambiguous Enter that flushes the buffered input, regardless of body
		// length. A short delay keeps the two chunks from coalescing into one read.
		const body = text.replace(/[\r\n]+$/, "");
		await target.client.terminal.writeInput.mutate({
			terminalId: sessionId,
			workspaceId: options.workspace,
			data: body,
		});
		await new Promise((resolve) => setTimeout(resolve, 150));
		await target.client.terminal.writeInput.mutate({
			terminalId: sessionId,
			workspaceId: options.workspace,
			data: "\r",
		});

		return {
			data: { ok: true },
			message: `Sent input to session ${sessionId} in workspace ${options.workspace}`,
		};
	},
});
