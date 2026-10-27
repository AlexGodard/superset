import { afterAll, describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rankHosts, reportPlacement } from "./index";

const dir = mkdtempSync(join(tmpdir(), "host-ranking-"));
const rankerPath = join(dir, "rank-hosts");
writeFileSync(rankerPath, "#!/bin/sh\n");
chmodSync(rankerPath, 0o755);
const missingPath = join(dir, "missing");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function execPrinting(stdout: string) {
	return mock(async () => ({ stdout, stderr: "" }));
}

describe("rankHosts", () => {
	test("returns null when no ranker is installed", async () => {
		const exec = execPrinting("[]");
		expect(await rankHosts(missingPath, exec)).toBeNull();
		expect(exec).not.toHaveBeenCalled();
	});

	test("returns the ranked hosts in the ranker's order", async () => {
		const hosts = [
			{ machineId: "mini", reason: "16 idle cores" },
			{ machineId: "mac", reason: "busy" },
		];
		const exec = execPrinting(JSON.stringify(hosts));
		expect(await rankHosts(rankerPath, exec)).toEqual(hosts);
		expect(exec).toHaveBeenCalledWith(rankerPath, [], { timeout: 15_000 });
	});

	test("returns no hosts when the ranker prints something else", async () => {
		expect(await rankHosts(rankerPath, execPrinting("not json"))).toEqual([]);
		expect(
			await rankHosts(rankerPath, execPrinting('[{"machineId":""}]')),
		).toEqual([]);
	});
});

describe("reportPlacement", () => {
	test("passes the host to the ranker", async () => {
		const exec = execPrinting("");
		expect(await reportPlacement("mini", [], rankerPath, exec)).toBe(true);
		expect(exec).toHaveBeenCalledWith(rankerPath, ["--placed", "mini"], {
			timeout: 5_000,
		});
	});

	test("passes the hosts Auto passed over in the environment", async () => {
		const exec = execPrinting("");
		const skipped = [
			{ machineId: "gaming", why: "unreachable" as const },
			{ machineId: "hetzner", why: "no-project" as const },
		];
		expect(await reportPlacement("mac", skipped, rankerPath, exec)).toBe(true);
		expect(exec).toHaveBeenCalledWith(rankerPath, ["--placed", "mac"], {
			timeout: 5_000,
			env: { SUPERSET_AUTO_SKIPPED: JSON.stringify(skipped) },
		});
	});

	test("does nothing when no ranker is installed", async () => {
		const exec = execPrinting("");
		expect(await reportPlacement("mini", [], missingPath, exec)).toBe(false);
		expect(exec).not.toHaveBeenCalled();
	});
});
