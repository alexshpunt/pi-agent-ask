import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	getToolExecution,
	getToolExecutionDetails,
	PiIntegrationTest,
	type PiIntegrationTestOptions,
	type PiRun,
	testArtifactsDir,
} from "pi-coding-agent-test";
import {
	herdrBlockedConversation,
	herdrQueueCheckpointConversation,
	herdrQueueResumeConversation,
} from "../fixtures/herdr-blocked-scenario.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const integration =
	process.env.ASK_HERDR_EXTENSION ??
	path.join(
		process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent"),
		"extensions",
		"herdr-agent-state.ts"
	);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

interface NativeScenario {
	conversation: NonNullable<PiIntegrationTestOptions["conversation"]>;
	paneId: string;
	resumeSession?: string;
	savedSession?: string;
	session: string;
	testName: string;
}

function runNative(scenario: NativeScenario): Promise<PiRun> {
	const environment: NodeJS.ProcessEnv = {};
	environment.ASK_HERDR_TARGET_SESSION = scenario.session;
	environment.ASK_HERDR_TARGET_PANE = scenario.paneId;
	if (scenario.savedSession) {
		environment.ASK_HERDR_SAVED_SESSION = scenario.savedSession;
	}
	if (scenario.resumeSession) {
		environment.ASK_HERDR_RESUME_SESSION = scenario.resumeSession;
	}
	const ask = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
	const driver = fileURLToPath(
		new URL("../fixtures/herdr-blocked-driver.ts", import.meta.url)
	);
	return new PiIntegrationTest({
		testName: scenario.testName,
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: root,
		isolateUserResources: true,
		piCommand: fileURLToPath(
			new URL("../fixtures/herdr-pi-command.ts", import.meta.url)
		),
		// Force a standalone adapter even under pi-test run; its terminal is not Pi's.
		tuiSize: { cols: 160, rows: 48 },
		environment,
		// Recovery must work even when the managed consumer initializes after Ask.
		extensions: scenario.resumeSession
			? [ask, driver, integration]
			: [integration, ask, driver],
		tools: ["ask_user", "herdr_queue_probe"],
		rawMode: false,
		conversation: scenario.conversation,
	}).run("Check the real Herdr status while the question queue stays open.");
}

function assertToolsSucceeded(result: PiRun, ids: string[]): void {
	for (const id of ids) {
		assert.equal(getToolExecution(result, id).isError, false, id);
	}
}

function queueStats(result: PiRun) {
	return getToolExecutionDetails(getToolExecution(result, "stats")) as {
		observations: Array<{ phase: string; status: string; question: string }>;
		status: string;
		activeForms: number;
	};
}

// Load Herdr's installed consumer, never an imitation. Pi must own Herdr's native PTY.
test("real Herdr tracks blocked queued and recovered questions", {
	timeout: 90_000,
	skip:
		!existsSync(integration) && "Herdr's installed Pi integration is required",
}, async (t) => {
	try {
		await exec("herdr", ["--version"]);
	} catch {
		t.skip("The Herdr CLI is required");
		return;
	}
	await mkdir(path.join(root, ".tmp"), { recursive: true });
	const directory = await mkdtemp(path.join(root, ".tmp", "herdr-blocked-"));
	const session = `ask-blocked-${process.pid}-${Date.now()}`;
	const config = path.join(directory, "config.toml");
	await writeFile(config, "");
	const env: NodeJS.ProcessEnv = { ...process.env };
	env.HERDR_SESSION = session;
	env.HERDR_CONFIG_PATH = config;
	for (const key of [
		"HERDR_SOCKET_PATH",
		"HERDR_WORKSPACE_ID",
		"HERDR_TAB_ID",
		"HERDR_PANE_ID",
	]) {
		delete env[key];
	}
	const cli = async (args: string[]) => {
		const { stdout } = await exec("herdr", ["--session", session, ...args], {
			env,
			timeout: 5000,
		});
		return stdout.trim() ? JSON.parse(stdout).result : undefined;
	};
	const createPane = async (): Promise<string> => {
		const deadline = Date.now() + 10_000;
		while (true) {
			try {
				return (await cli(["workspace", "create", "--cwd", root, "--no-focus"]))
					.root_pane.pane_id;
			} catch (error) {
				if (Date.now() >= deadline) {
					throw error;
				}
				await tick();
			}
		}
	};
	const assertNativeScreen = async (paneId: string, visible: string[]) => {
		// The adapter's terminal is not native Pi output. Inspect the real owned pane.
		const { stdout } = await exec(
			"herdr",
			[
				"--session",
				session,
				"pane",
				"read",
				paneId,
				"--source",
				"recent-unwrapped",
				"--lines",
				"120",
			],
			{ env, timeout: 5000 }
		);
		for (const text of visible) {
			assert(stdout.includes(text), text);
		}
	};
	const server = spawn("herdr", ["--session", session, "server"], {
		env,
		stdio: "ignore",
	});
	try {
		await t.test(
			"keeps blocked during work, queue handoff, and idle",
			async () => {
				const paneId = await createPane();
				const result = await runNative({
					session,
					paneId,
					testName: "herdr-native-queue",
					conversation: herdrBlockedConversation,
				});
				assertToolsSucceeded(result, [
					"first-form",
					"second-form",
					"first",
					"second",
					"idle",
					"stats",
				]);
				const stats = queueStats(result);
				assert.deepEqual(stats.observations, [
					{ phase: "working-first", status: "blocked", question: "first" },
					{ phase: "handoff-second", status: "blocked", question: "second" },
					{ phase: "working-second", status: "blocked", question: "second" },
					{ phase: "idle", status: "blocked", question: "second" },
				]);
				assert.equal(stats.activeForms, 0);
				assert.notEqual(stats.status, "blocked");
				await assertNativeScreen(paneId, [
					"Choose first?",
					"Choose second?",
					"Herdr queue verification complete.",
				]);
				t.diagnostic(JSON.stringify(stats));
			}
		);
		await t.test(
			"restores blocked after restarting Pi with the consumer loaded last",
			async () => {
				const paneId = await createPane();
				const savedSession = path.join(directory, "pending-session.jsonl");
				const checkpoint = await runNative({
					session,
					paneId,
					savedSession,
					testName: "herdr-queue-checkpoint",
					conversation: herdrQueueCheckpointConversation,
				});
				assertToolsSucceeded(checkpoint, [
					"first-form",
					"second-form",
					"first",
					"second",
					"checkpoint",
				]);
				assert(
					existsSync(savedSession),
					"The pending session must be saved before the runner cleans up"
				);
				assert.equal(
					(await cli(["pane", "get", paneId])).pane.agent_status,
					"blocked"
				);
				await cli(["pane", "close", paneId]);
				const restoredPane = await createPane();
				const result = await runNative({
					session,
					paneId: restoredPane,
					resumeSession: savedSession,
					testName: "herdr-queue-resume",
					conversation: herdrQueueResumeConversation,
				});
				assertToolsSucceeded(result, ["recover", "idle", "stats"]);
				const stats = queueStats(result);
				assert.deepEqual(stats.observations, [
					{ phase: "recovered", status: "blocked", question: "second" },
					{ phase: "idle", status: "blocked", question: "second" },
				]);
				assert.equal(stats.activeForms, 0);
				assert.notEqual(stats.status, "blocked");
				await assertNativeScreen(restoredPane, [
					"Choose second?",
					"Recovered queue verification complete.",
				]);
				t.diagnostic(JSON.stringify(stats));
			}
		);
	} finally {
		await exec("herdr", ["--session", session, "server", "stop"], {
			env,
			timeout: 5000,
		}).catch(() => undefined);
		server.kill();
		await exec("herdr", ["session", "delete", session], {
			env,
			timeout: 5000,
		}).catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	}
});
