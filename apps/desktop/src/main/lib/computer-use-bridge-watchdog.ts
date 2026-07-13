import os from "node:os";
import path from "node:path";
import {
	captureProcessSnapshot,
	type ProcessInfo,
} from "./resource-metrics/process-tree";
import { treeKillWithEscalation } from "./tree-kill";

/**
 * Containment for a failure in the signed Computer Use helper, whose source is
 * outside this repository. The observed accessibility traversal can encounter
 * an object cycle before appending the repeated object because it does not keep
 * a visited-object set. The 200-item guard logs and rejects that append; it does
 * not continue recursion. Other already-dispatched traversal work can revisit
 * the same cycle and keep the helper busy indefinitely.
 *
 * We deliberately require three complete five-second high-resource intervals
 * so normal foreground captures are untouched. Terminating only the helper
 * aborts the wedged request; the Computer Use client launches a clean helper on
 * the next request.
 *
 * This resource circuit breaker intentionally does not handle a low-CPU
 * `timeoutReached` request outcome. That belongs in the standalone
 * request-aware recovery path at the Computer Use client/request boundary.
 */
const BRIDGE_APP_EXECUTABLE_RELATIVE_PATH = path.join(
	"Codex Computer Use.app",
	"Contents",
	"MacOS",
	"SkyComputerUseService",
);
const CANONICAL_BRIDGE_ROOT_RELATIVE_PATH = path.join(".codex", "computer-use");
const PLUGIN_CACHE_BRIDGE_ROOT_RELATIVE_PATH = path.join(
	".codex",
	"plugins",
	"cache",
	"openai-bundled",
	"computer-use",
);
const BRIDGE_EXECUTABLE = "SkyComputerUseService";
const SAMPLE_INTERVAL_MS = 5_000;
const CPU_THRESHOLD_PERCENT = 80;
const MEMORY_THRESHOLD_BYTES = 1_000_000_000;
const REQUIRED_RUNAWAY_INTERVALS = 3;
const RECOVERY_COOLDOWN_MS = 60_000;

interface BridgeProcessInfo extends ProcessInfo {
	uid: number;
	executable: string;
}

interface BridgeProcessProvenance {
	homeDirectory: string;
	currentUid: number;
}

interface WatchdogDependencies {
	now: () => number;
	listBridgeProcesses: () => Promise<BridgeProcessInfo[]>;
	terminate: (pid: number) => Promise<{ success: boolean; error?: string }>;
	warn: (message: string) => void;
}

interface RunawayState {
	confirmedIntervals: number;
	lastConfirmationAt: number;
	peakCpu: number;
	peakMemory: number;
}

interface RecoveryCandidate {
	processInfo: BridgeProcessInfo;
	state: RunawayState;
}

export function isComputerUseBridgeProcess(
	processInfo: ProcessInfo,
	provenance: BridgeProcessProvenance,
): processInfo is BridgeProcessInfo {
	return (
		processInfo.uid === provenance.currentUid &&
		isExpectedBridgeExecutable(processInfo.executable, provenance.homeDirectory)
	);
}

function isExpectedBridgeExecutable(
	executable: string | undefined,
	homeDirectory: string,
): boolean {
	if (!executable) return false;

	const canonicalExecutable = path.join(
		homeDirectory,
		CANONICAL_BRIDGE_ROOT_RELATIVE_PATH,
		BRIDGE_APP_EXECUTABLE_RELATIVE_PATH,
	);
	if (executable === canonicalExecutable) return true;

	const pluginCacheRoot = path.join(
		homeDirectory,
		PLUGIN_CACHE_BRIDGE_ROOT_RELATIVE_PATH,
	);
	const relativePluginExecutable = path.relative(pluginCacheRoot, executable);
	const [version, ...executableSegments] = relativePluginExecutable.split(
		path.sep,
	);
	return (
		Boolean(version) &&
		version !== "." &&
		version !== ".." &&
		executableSegments.join(path.sep) === BRIDGE_APP_EXECUTABLE_RELATIVE_PATH
	);
}

async function listBridgeProcesses(
	provenance: BridgeProcessProvenance,
): Promise<BridgeProcessInfo[]> {
	const snapshot = await captureProcessSnapshot();
	return [...snapshot.byPid.values()].filter((processInfo) =>
		isComputerUseBridgeProcess(processInfo, provenance),
	);
}

export class ComputerUseBridgeWatchdog {
	private readonly runawayByPid = new Map<number, RunawayState>();
	private recoveryCooldownUntil = 0;
	private sampleInFlight = false;

	constructor(private readonly dependencies: WatchdogDependencies) {}

	async sample(): Promise<void> {
		if (this.sampleInFlight) return;
		this.sampleInFlight = true;

		try {
			const processes = await this.dependencies.listBridgeProcesses();
			const livePids = new Set(processes.map((processInfo) => processInfo.pid));
			for (const pid of this.runawayByPid.keys()) {
				if (!livePids.has(pid)) this.runawayByPid.delete(pid);
			}

			const now = this.dependencies.now();
			const candidates: RecoveryCandidate[] = [];
			for (const processInfo of processes) {
				const candidate = this.observe(processInfo, now);
				if (candidate) candidates.push(candidate);
			}

			if (candidates.length === 0 || now < this.recoveryCooldownUntil) {
				return;
			}

			this.recoveryCooldownUntil = now + RECOVERY_COOLDOWN_MS;
			for (const candidate of candidates) {
				this.runawayByPid.delete(candidate.processInfo.pid);
				await this.recover(candidate);
			}
		} finally {
			this.sampleInFlight = false;
		}
	}

	private observe(
		processInfo: BridgeProcessInfo,
		now: number,
	): RecoveryCandidate | null {
		const runaway =
			processInfo.cpu >= CPU_THRESHOLD_PERCENT ||
			processInfo.memory >= MEMORY_THRESHOLD_BYTES;
		if (!runaway) {
			this.runawayByPid.delete(processInfo.pid);
			return null;
		}

		const previous = this.runawayByPid.get(processInfo.pid);
		if (!previous) {
			this.runawayByPid.set(processInfo.pid, {
				confirmedIntervals: 0,
				lastConfirmationAt: now,
				peakCpu: processInfo.cpu,
				peakMemory: processInfo.memory,
			});
			return null;
		}

		const state: RunawayState = {
			confirmedIntervals: previous.confirmedIntervals,
			lastConfirmationAt: previous.lastConfirmationAt,
			peakCpu: Math.max(previous.peakCpu, processInfo.cpu),
			peakMemory: Math.max(previous.peakMemory, processInfo.memory),
		};
		if (now - previous.lastConfirmationAt >= SAMPLE_INTERVAL_MS) {
			state.confirmedIntervals += 1;
			state.lastConfirmationAt = now;
		}
		this.runawayByPid.set(processInfo.pid, state);

		return state.confirmedIntervals >= REQUIRED_RUNAWAY_INTERVALS
			? { processInfo, state }
			: null;
	}

	private async recover(candidate: RecoveryCandidate): Promise<void> {
		const { processInfo, state } = candidate;
		const result = await this.dependencies.terminate(processInfo.pid);
		const memoryMb = Math.round(state.peakMemory / 1_000_000);
		if (result.success) {
			this.dependencies.warn(
				`[computer-use-watchdog] Restarted runaway ${BRIDGE_EXECUTABLE} pid=${processInfo.pid} after ${state.confirmedIntervals} complete ${SAMPLE_INTERVAL_MS / 1_000}-second intervals (peakCpu=${state.peakCpu.toFixed(1)}%, peakMemory=${memoryMb}MB). The next Computer Use request will relaunch the bridge.`,
			);
			return;
		}

		this.dependencies.warn(
			`[computer-use-watchdog] Failed to stop runaway ${BRIDGE_EXECUTABLE} pid=${processInfo.pid} (peakCpu=${state.peakCpu.toFixed(1)}%, peakMemory=${memoryMb}MB): ${result.error ?? "unknown error"}`,
		);
	}
}

interface WatchdogLifecycleDependencies {
	platform: NodeJS.Platform;
	createWatchdog: () => Pick<ComputerUseBridgeWatchdog, "sample">;
	setInterval: (
		callback: () => void,
		delay: number,
	) => ReturnType<typeof globalThis.setInterval>;
	clearInterval: (interval: ReturnType<typeof globalThis.setInterval>) => void;
}

export class ComputerUseBridgeWatchdogLifecycle {
	private watchdog: Pick<ComputerUseBridgeWatchdog, "sample"> | null = null;
	private interval: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly dependencies: WatchdogLifecycleDependencies) {}

	start(): void {
		if (this.dependencies.platform !== "darwin" || this.interval) return;

		this.watchdog = this.dependencies.createWatchdog();
		void this.watchdog.sample();
		this.interval = this.dependencies.setInterval(() => {
			void this.watchdog?.sample();
		}, SAMPLE_INTERVAL_MS);
		this.interval.unref();
	}

	stop(): void {
		if (!this.interval) return;
		this.dependencies.clearInterval(this.interval);
		this.interval = null;
		this.watchdog = null;
	}
}

const bridgeProcessProvenance: BridgeProcessProvenance = {
	homeDirectory: os.homedir(),
	currentUid: os.userInfo().uid,
};
const watchdogLifecycle = new ComputerUseBridgeWatchdogLifecycle({
	platform: os.platform(),
	createWatchdog: () =>
		new ComputerUseBridgeWatchdog({
			now: Date.now,
			listBridgeProcesses: () => listBridgeProcesses(bridgeProcessProvenance),
			terminate: (pid) => treeKillWithEscalation({ pid }),
			warn: (message) => console.warn(message),
		}),
	setInterval: globalThis.setInterval,
	clearInterval: globalThis.clearInterval,
});

export function startComputerUseBridgeWatchdog(): void {
	watchdogLifecycle.start();
}

export function stopComputerUseBridgeWatchdog(): void {
	watchdogLifecycle.stop();
}
