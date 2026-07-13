import { exec } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

let nativeMetrics: typeof import("@superset/macos-process-metrics") | null =
	null;
try {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	nativeMetrics = require("@superset/macos-process-metrics");
} catch {
	// Native addon unavailable (non-macOS or build skipped).
}

const execAsync = promisify(exec);
const EXEC_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 10 * 1024 * 1024;

export interface ProcessInfo {
	pid: number;
	ppid: number;
	/** Numeric owner ID when available. */
	uid?: number;
	/** Executable path/name when available. */
	executable?: string;
	/** CPU usage as a percentage (can exceed 100 on multi-core). */
	cpu: number;
	/** Resident memory in bytes. */
	memory: number;
}

export interface ProcessSnapshot {
	/** Process info keyed by PID. */
	byPid: Map<number, ProcessInfo>;
	/** Child PIDs keyed by parent PID. */
	childrenOf: Map<number, number[]>;
}

export interface SubtreeResources {
	cpu: number;
	memory: number;
	pids: number[];
}

/**
 * Capture an atomic snapshot of all running processes.
 *
 * On macOS/Linux a single `ps` call returns PID, parent PID, CPU%, and
 * RSS together — so the tree structure and resource numbers are from the
 * same point in time (no race between "discover children" and "read
 * metrics" that the old pidtree+pidusage two-step had).
 *
 * On Windows, uses PowerShell/Get-CimInstance for tree + memory.
 */
export async function captureProcessSnapshot(): Promise<ProcessSnapshot> {
	const raw =
		os.platform() === "win32"
			? await listProcessesWindows()
			: await listProcessesUnix();

	const byPid = new Map<number, ProcessInfo>();
	const childrenOf = new Map<number, number[]>();

	for (const p of raw) {
		byPid.set(p.pid, p);
		let children = childrenOf.get(p.ppid);
		if (!children) {
			children = [];
			childrenOf.set(p.ppid, children);
		}
		children.push(p.pid);
	}

	return { byPid, childrenOf };
}

/**
 * Return every PID that is a descendant of `rootPid` (including
 * `rootPid` itself), provided the PID exists in the snapshot.
 */
export function getSubtreePids(
	snapshot: ProcessSnapshot,
	rootPid: number,
): number[] {
	const pids: number[] = [];
	const stack = [rootPid];
	const visited = new Set<number>();

	while (stack.length > 0) {
		const pid = stack.pop();
		if (pid === undefined || visited.has(pid)) continue;
		visited.add(pid);

		if (snapshot.byPid.has(pid)) {
			pids.push(pid);
		}
		const children = snapshot.childrenOf.get(pid);
		if (children) {
			for (const child of children) {
				stack.push(child);
			}
		}
	}

	return pids;
}

/**
 * Sum CPU and memory for the entire process subtree rooted at `rootPid`.
 */
export function getSubtreeResources(
	snapshot: ProcessSnapshot,
	rootPid: number,
): SubtreeResources {
	const pids = getSubtreePids(snapshot, rootPid);
	let cpu = 0;
	let memory = 0;

	for (const pid of pids) {
		const info = snapshot.byPid.get(pid);
		if (info) {
			cpu += info.cpu;
			memory += info.memory;
		}
	}

	return { cpu, memory, pids };
}

/**
 * Replace RSS values with macOS `phys_footprint` for the given PIDs.
 *
 * `phys_footprint` is what Activity Monitor shows as "Memory" — it
 * accounts for compressed pages, unlike RSS which always reports the
 * uncompressed size.  On non-macOS platforms this is a no-op.
 */
export function enrichWithPhysFootprint(
	snapshot: ProcessSnapshot,
	pids: number[],
): void {
	if (!nativeMetrics || pids.length === 0) return;
	try {
		const footprints = nativeMetrics.getPhysFootprints(pids);
		for (const pid of pids) {
			const footprint = footprints[pid];
			const info = snapshot.byPid.get(pid);
			if (info && typeof footprint === "number" && footprint > 0) {
				info.memory = footprint;
			}
		}
	} catch {
		// Fall back to RSS already in the snapshot.
	}
}

// ── Platform-specific process listing ─────────────────────────────────

async function listProcessesUnix(): Promise<ProcessInfo[]> {
	try {
		// Single call: UID, PID, parent PID, %CPU, RSS (KB), executable path/name.
		const { stdout } = await execAsync(
			"ps -eo uid=,pid=,ppid=,pcpu=,rss=,comm=",
			{
				maxBuffer: MAX_BUFFER,
				timeout: EXEC_TIMEOUT_MS,
			},
		);

		return parseUnixProcessList(stdout);
	} catch {
		return [];
	}
}

export function parseUnixProcessList(stdout: string): ProcessInfo[] {
	const result: ProcessInfo[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const parts = trimmed.split(/\s+/);
		if (parts.length < 6) continue;

		const uid = Number.parseInt(parts[0], 10);
		const pid = Number.parseInt(parts[1], 10);
		const ppid = Number.parseInt(parts[2], 10);
		if (Number.isNaN(uid) || Number.isNaN(pid) || Number.isNaN(ppid)) {
			continue;
		}

		const cpu = Number.parseFloat(parts[3]);
		const rssKb = Number.parseInt(parts[4], 10);

		result.push({
			pid,
			ppid,
			uid,
			executable: parts.slice(5).join(" "),
			cpu: Number.isFinite(cpu) ? Math.max(0, cpu) : 0,
			memory: Number.isFinite(rssKb) ? Math.max(0, rssKb) * 1024 : 0,
		});
	}

	return result;
}

async function listProcessesWindows(): Promise<ProcessInfo[]> {
	try {
		const { stdout } = await execAsync(
			'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Csv -NoTypeInformation"',
			{ maxBuffer: MAX_BUFFER, timeout: EXEC_TIMEOUT_MS },
		);

		const result: ProcessInfo[] = [];
		for (const line of stdout.trim().split("\n").slice(1)) {
			const clean = line.trim().replace(/"/g, "");
			if (!clean) continue;

			const parts = clean.split(",");
			if (parts.length < 3) continue;

			const pid = Number.parseInt(parts[0], 10);
			const ppid = Number.parseInt(parts[1], 10);
			if (Number.isNaN(pid) || Number.isNaN(ppid)) continue;

			const ws = Number.parseInt(parts[2], 10);

			result.push({
				pid,
				ppid,
				cpu: 0, // Windows CPU% needs delta sampling; enriched separately.
				memory: Number.isFinite(ws) ? Math.max(0, ws) : 0,
			});
		}

		return result;
	} catch {
		return [];
	}
}
