import { describe, expect, it, mock } from "bun:test";
import {
	ComputerUseBridgeWatchdog,
	ComputerUseBridgeWatchdogLifecycle,
	isComputerUseBridgeProcess,
} from "./computer-use-bridge-watchdog";

interface TestProcess {
	pid: number;
	ppid: number;
	uid: number;
	executable: string;
	cpu: number;
	memory: number;
}

const CURRENT_UID = 501;
const HOME_DIRECTORY = "/Users/alexandre";
const BRIDGE_EXECUTABLE_PATH =
	"/Users/alexandre/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService";
const PLUGIN_CACHE_BRIDGE_EXECUTABLE_PATH =
	"/Users/alexandre/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService";
const RUNAWAY_PROCESS: TestProcess = {
	pid: 42,
	ppid: 1,
	uid: CURRENT_UID,
	executable: BRIDGE_EXECUTABLE_PATH,
	cpu: 112,
	memory: 250_000_000,
};

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createHarness({ terminateSuccess = true } = {}) {
	let now = 0;
	let processes: TestProcess[] = [];
	const terminate = mock(async (_pid: number) =>
		terminateSuccess
			? { success: true }
			: { success: false, error: "permission denied" },
	);
	const warn = mock((_message: string) => {});
	const listBridgeProcesses = mock(async () => processes);
	const watchdog = new ComputerUseBridgeWatchdog({
		now: () => now,
		listBridgeProcesses,
		terminate,
		warn,
	});

	return {
		watchdog,
		terminate,
		warn,
		setProcesses: (next: TestProcess[]) => {
			processes = next;
		},
		sampleAfter: async (milliseconds: number) => {
			now += milliseconds;
			await watchdog.sample();
		},
	};
}

async function reachRecoveryThreshold(
	harness: ReturnType<typeof createHarness>,
): Promise<void> {
	await harness.sampleAfter(0);
	await harness.sampleAfter(5_000);
	await harness.sampleAfter(5_000);
	await harness.sampleAfter(5_000);
}

describe("isComputerUseBridgeProcess", () => {
	it("matches the current-user canonical helper without requiring Superset parentage", () => {
		expect(
			isComputerUseBridgeProcess(
				{ ...RUNAWAY_PROCESS, ppid: 98_765 },
				{
					homeDirectory: HOME_DIRECTORY,
					currentUid: CURRENT_UID,
				},
			),
		).toBe(true);
	});

	it("matches a current-user helper launched from the versioned OpenAI plugin cache", () => {
		expect(
			isComputerUseBridgeProcess(
				{
					...RUNAWAY_PROCESS,
					ppid: 98_765,
					executable: PLUGIN_CACHE_BRIDGE_EXECUTABLE_PATH,
				},
				{
					homeDirectory: HOME_DIRECTORY,
					currentUid: CURRENT_UID,
				},
			),
		).toBe(true);
	});

	it("rejects a same-named executable outside the installed Computer Use app", () => {
		expect(
			isComputerUseBridgeProcess(
				{
					...RUNAWAY_PROCESS,
					executable: "/tmp/SkyComputerUseService",
				},
				{
					homeDirectory: HOME_DIRECTORY,
					currentUid: CURRENT_UID,
				},
			),
		).toBe(false);
	});

	it("rejects the expected path when it belongs to another user", () => {
		expect(
			isComputerUseBridgeProcess(
				{ ...RUNAWAY_PROCESS, uid: 0 },
				{
					homeDirectory: HOME_DIRECTORY,
					currentUid: CURRENT_UID,
				},
			),
		).toBe(false);
	});
});

describe("ComputerUseBridgeWatchdog", () => {
	it("requires three complete five-second runaway intervals", async () => {
		const harness = createHarness();
		harness.setProcesses([RUNAWAY_PROCESS]);

		await harness.sampleAfter(0);
		await harness.sampleAfter(5_000);
		await harness.sampleAfter(5_000);
		expect(harness.terminate).not.toHaveBeenCalled();

		await harness.sampleAfter(4_999);
		expect(harness.terminate).not.toHaveBeenCalled();

		await harness.sampleAfter(1);
		expect(harness.terminate).toHaveBeenCalledTimes(1);
		expect(harness.terminate).toHaveBeenCalledWith(42);
		expect(harness.warn.mock.calls[0]?.[0]).toContain("peakCpu=112.0%");
	});

	it("does not count repeated samples inside one timer interval", async () => {
		const harness = createHarness();
		harness.setProcesses([RUNAWAY_PROCESS]);

		await harness.sampleAfter(0);
		for (let sample = 0; sample < 10; sample += 1) {
			await harness.sampleAfter(0);
		}
		await harness.sampleAfter(5_000);
		await harness.sampleAfter(5_000);

		expect(harness.terminate).not.toHaveBeenCalled();
		await harness.sampleAfter(5_000);
		expect(harness.terminate).toHaveBeenCalledTimes(1);
	});

	it("does not interrupt normal foreground Computer Use activity", async () => {
		const harness = createHarness();
		harness.setProcesses([{ ...RUNAWAY_PROCESS, cpu: 22, memory: 90_000_000 }]);

		for (let sample = 0; sample < 20; sample += 1) {
			await harness.sampleAfter(5_000);
		}

		expect(harness.terminate).not.toHaveBeenCalled();
		expect(harness.warn).not.toHaveBeenCalled();
	});

	it("requires consecutive runaway intervals", async () => {
		const harness = createHarness();
		harness.setProcesses([RUNAWAY_PROCESS]);
		await harness.sampleAfter(0);
		await harness.sampleAfter(5_000);

		harness.setProcesses([{ ...RUNAWAY_PROCESS, cpu: 10 }]);
		await harness.sampleAfter(5_000);

		harness.setProcesses([RUNAWAY_PROCESS]);
		await harness.sampleAfter(5_000);
		await harness.sampleAfter(5_000);
		await harness.sampleAfter(5_000);
		expect(harness.terminate).not.toHaveBeenCalled();

		await harness.sampleAfter(5_000);
		expect(harness.terminate).toHaveBeenCalledTimes(1);
	});

	it("also contains a memory runaway", async () => {
		const harness = createHarness();
		harness.setProcesses([
			{ ...RUNAWAY_PROCESS, cpu: 5, memory: 1_400_000_000 },
		]);

		await reachRecoveryThreshold(harness);

		expect(harness.terminate).toHaveBeenCalledTimes(1);
		expect(harness.warn.mock.calls[0]?.[0]).toContain("peakMemory=1400MB");
	});

	it("terminates every helper that reaches the threshold together", async () => {
		const harness = createHarness();
		harness.setProcesses([
			RUNAWAY_PROCESS,
			{ ...RUNAWAY_PROCESS, pid: 43, ppid: 99_999, cpu: 95 },
		]);

		await reachRecoveryThreshold(harness);

		expect(harness.terminate).toHaveBeenCalledTimes(2);
		expect(harness.terminate.mock.calls.map(([pid]) => pid).sort()).toEqual([
			42, 43,
		]);
	});

	it("keeps the cooldown after a termination failure", async () => {
		const harness = createHarness({ terminateSuccess: false });
		harness.setProcesses([RUNAWAY_PROCESS]);
		await reachRecoveryThreshold(harness);

		expect(harness.terminate).toHaveBeenCalledTimes(1);
		expect(harness.warn.mock.calls[0]?.[0]).toContain("permission denied");

		for (let sample = 0; sample < 11; sample += 1) {
			await harness.sampleAfter(5_000);
		}
		expect(harness.terminate).toHaveBeenCalledTimes(1);

		await harness.sampleAfter(5_000);
		expect(harness.terminate).toHaveBeenCalledTimes(2);
	});

	it("suppresses overlapping process snapshots", async () => {
		const snapshot = deferred<TestProcess[]>();
		const listBridgeProcesses = mock(() => snapshot.promise);
		const terminate = mock(async (_pid: number) => ({ success: true }));
		const watchdog = new ComputerUseBridgeWatchdog({
			now: () => 0,
			listBridgeProcesses,
			terminate,
			warn: () => {},
		});

		const firstSample = watchdog.sample();
		const overlappingSample = watchdog.sample();
		expect(listBridgeProcesses).toHaveBeenCalledTimes(1);

		snapshot.resolve([]);
		await Promise.all([firstSample, overlappingSample]);
		expect(terminate).not.toHaveBeenCalled();
	});
});

describe("ComputerUseBridgeWatchdogLifecycle", () => {
	it("starts once on macOS, samples immediately, and clears its timer", () => {
		const sample = mock(async () => {});
		const clearInterval = mock(
			(_timer: ReturnType<typeof globalThis.setInterval>) => {},
		);
		const unref = mock(() => {});
		const timer = { unref } as unknown as ReturnType<
			typeof globalThis.setInterval
		>;
		const setInterval = mock(
			(
				_callback: () => void,
				_delay: number,
			): ReturnType<typeof globalThis.setInterval> => timer,
		);
		const createWatchdog = mock(() => ({ sample }));
		const lifecycle = new ComputerUseBridgeWatchdogLifecycle({
			platform: "darwin",
			createWatchdog,
			setInterval,
			clearInterval,
		});

		lifecycle.start();
		lifecycle.start();

		expect(createWatchdog).toHaveBeenCalledTimes(1);
		expect(sample).toHaveBeenCalledTimes(1);
		expect(setInterval).toHaveBeenCalledTimes(1);
		expect(setInterval.mock.calls[0]?.[1]).toBe(5_000);
		expect(unref).toHaveBeenCalledTimes(1);

		lifecycle.stop();
		expect(clearInterval).toHaveBeenCalledWith(timer);
	});

	it("does not start outside macOS", () => {
		const createWatchdog = mock(() => ({ sample: mock(async () => {}) }));
		const setInterval = mock(
			(_callback: () => void, _delay: number) =>
				({ unref: () => {} }) as unknown as ReturnType<
					typeof globalThis.setInterval
				>,
		);
		const lifecycle = new ComputerUseBridgeWatchdogLifecycle({
			platform: "linux",
			createWatchdog,
			setInterval,
			clearInterval: () => {},
		});

		lifecycle.start();

		expect(createWatchdog).not.toHaveBeenCalled();
		expect(setInterval).not.toHaveBeenCalled();
	});
});
