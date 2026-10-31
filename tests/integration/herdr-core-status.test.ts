import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	getToolExecution,
	getToolExecutionDetails,
	PiIntegrationTest,
	testArtifactsDir,
} from "pi-coding-agent-test";
import {
	herdrBlockedConversation,
	herdrForegroundConversation,
} from "../fixtures/herdr-blocked-scenario.ts";

const exec = promisify(execFile);

test("Herdr core receives OSC 7501 from real Pi custom question panels", {
	timeout: 60_000,
	skip:
		process.env.ASK_HERDR_CORE_TEST !== "1" &&
		"Requires local Herdr core and Pi with terminal.setProgramStatus",
}, async (t) => {
	await exec("hc", ["server", "status"]);
	const directory = await mkdtemp(path.join(tmpdir(), "ask-herdr-core-"));
	const addressFile = path.join(directory, "terminal");
	const environment: NodeJS.ProcessEnv = {};
	environment.ASK_HERDR_ADDRESS_FILE = addressFile;
	try {
		const run = (
			testName: string,
			conversation: typeof herdrBlockedConversation
		) =>
			new PiIntegrationTest({
				testName,
				artifactsDir: testArtifactsDir(import.meta.filename),
				cwd: fileURLToPath(new URL("../../", import.meta.url)),
				isolateUserResources: true,
				piCommand: fileURLToPath(
					new URL("../fixtures/herdr-core-pi-command.ts", import.meta.url)
				),
				tuiSize: { cols: 160, rows: 48 },
				environment,
				extensions: [
					process.env.ASK_HERDR_TEST_EXTENSION ??
						fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
					fileURLToPath(
						new URL("../fixtures/herdr-blocked-driver.ts", import.meta.url)
					),
				],
				tools: ["ask_user", "wait_for_answers", "herdr_queue_probe"],
				rawMode: false,
				conversation,
			}).run("Check Herdr core status with the real question queue.");
		const result = await run(
			"herdr-core-question-status",
			herdrBlockedConversation
		);
		for (const id of [
			"first-form",
			"second-form",
			"first",
			"second",
			"hide",
			"reopen",
			"idle",
			"stats",
		]) {
			assert.equal(getToolExecution(result, id).isError, false, id);
		}
		const stats = getToolExecutionDetails(
			getToolExecution(result, "stats")
		) as {
			observations: { phase: string; status: string; question: string }[];
			status: string;
			activeForms: number;
		};
		assert.deepEqual(stats.observations, [
			{ phase: "working-first", status: "blocked", question: "first" },
			{ phase: "handoff-second", status: "blocked", question: "second" },
			{ phase: "working-second", status: "blocked", question: "second" },
			{ phase: "hidden", status: "working", question: "second" },
			{ phase: "reopened", status: "blocked", question: "second" },
			{ phase: "idle", status: "blocked", question: "second" },
		]);
		assert.equal(stats.activeForms, 0);
		assert.notEqual(stats.status, "blocked");
		t.diagnostic(JSON.stringify(stats));
		const firstAddress = await readFile(addressFile, "utf8");
		await exec("hc", ["kill", firstAddress]);
		await exec("hc", ["rm", firstAddress]);
		const foreground = await run(
			"herdr-core-foreground-status",
			herdrForegroundConversation
		);
		for (const id of [
			"foreground-form",
			"background-form",
			"explicit-wait",
			"stats",
		]) {
			assert.equal(getToolExecution(foreground, id).isError, false, id);
		}
		const foregroundStats = getToolExecutionDetails(
			getToolExecution(foreground, "stats")
		) as typeof stats;
		assert.deepEqual(foregroundStats.observations, [
			{ phase: "foreground", status: "blocked", question: "foreground" },
			{ phase: "explicit-wait", status: "blocked", question: "first" },
		]);
		assert.equal(foregroundStats.activeForms, 0);
		assert.notEqual(foregroundStats.status, "blocked");
		t.diagnostic(JSON.stringify(foregroundStats));
	} finally {
		const address = await readFile(addressFile, "utf8").catch(() => undefined);
		if (address) {
			await exec("hc", ["kill", address]);
			await exec("hc", ["rm", address]);
		}
		await rm(directory, { recursive: true, force: true });
	}
});
