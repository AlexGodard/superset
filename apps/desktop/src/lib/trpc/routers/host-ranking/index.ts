import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { SUPERSET_HOME_DIR } from "main/lib/app-environment";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { execWithShellEnv } from "../workspaces/utils/shell-env";

const RANKER_PATH = join(SUPERSET_HOME_DIR, "rank-hosts");
const RANK_TIMEOUT_MS = 15_000;
const PLACED_TIMEOUT_MS = 5_000;

const rankedHostsSchema = z.array(
	z.object({ machineId: z.string().min(1), reason: z.string() }),
);

export type RankedHost = z.infer<typeof rankedHostsSchema>[number];

type Exec = typeof execWithShellEnv;

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Hosts best-first, as the user's own `rank-hosts` executable orders them.
 * Null when there is no ranker, so the device picker offers no Auto entry.
 */
export async function rankHosts(
	rankerPath = RANKER_PATH,
	exec: Exec = execWithShellEnv,
): Promise<RankedHost[] | null> {
	if (!(await isExecutable(rankerPath))) return null;
	try {
		const { stdout } = await exec(rankerPath, [], { timeout: RANK_TIMEOUT_MS });
		return rankedHostsSchema.parse(JSON.parse(stdout));
	} catch (error) {
		console.warn("[host-ranking] rank-hosts failed:", error);
		return [];
	}
}

/** Tells the ranker a workspace went to a host, so it can count it next time. */
export async function reportPlacement(
	machineId: string,
	rankerPath = RANKER_PATH,
	exec: Exec = execWithShellEnv,
): Promise<boolean> {
	if (!(await isExecutable(rankerPath))) return false;
	try {
		await exec(rankerPath, ["--placed", machineId], {
			timeout: PLACED_TIMEOUT_MS,
		});
		return true;
	} catch (error) {
		console.warn("[host-ranking] rank-hosts --placed failed:", error);
		return false;
	}
}

export const createHostRankingRouter = () => {
	return router({
		rank: publicProcedure.query(() => rankHosts()),
		placed: publicProcedure
			.input(z.object({ machineId: z.string().min(1) }))
			.mutation(({ input }) => reportPlacement(input.machineId)),
	});
};
