import { CLIError, positional, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { resolveHostTarget } from "../../../lib/host-target";

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
			.desc("Message to inject; submitted with a trailing newline"),
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

		const cloudWorkspace = await ctx.api.v2Workspace.getFromHost.query({
			organizationId,
			id: options.workspace,
		});
		if (!cloudWorkspace) {
			throw new CLIError(`Workspace not found: ${options.workspace}`);
		}

		const target = resolveHostTarget({
			requestedHostId: cloudWorkspace.hostId,
			organizationId,
			userJwt: ctx.bearer,
		});

		// Mirror normalizeTerminalCommand: append LF (not CR) iff absent so the
		// agent submits the message instead of leaving it in the input box.
		const data = text.endsWith("\n") ? text : `${text}\n`;

		await target.client.terminal.writeInput.mutate({
			terminalId: sessionId,
			workspaceId: options.workspace,
			data,
		});

		return {
			data: { ok: true },
			message: `Sent input to session ${sessionId} in workspace ${options.workspace}`,
		};
	},
});
