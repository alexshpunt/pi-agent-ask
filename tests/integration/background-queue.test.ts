import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getProviderSystemPrompt,
	getToolExecution,
	getToolExecutionDetails,
	getToolResultText,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const form = (id: string) => ({
	background: true,
	title: id,
	questions: [
		{ id, prompt: `Choose ${id}?`, options: [{ value: "yes", label: "Yes" }] },
	],
});
const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});

test("real Pi keeps researching, delivers the first answer, and waits for the second", {
	timeout: 60_000,
}, async () => {
	const result = await new PiIntegrationTest({
		testName: "background-queue",
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: root,
		isolateUserResources: true,
		extensions: [
			fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			fileURLToPath(
				new URL("../fixtures/background-driver.ts", import.meta.url)
			),
		],
		tools: ["ask_user", "wait_for_answers", "queue_probe"],
		rawMode: false,
		conversation: [
			call("first-form", "ask_user", form("first")),
			call("second-form", "ask_user", form("second")),
			call("research", "queue_probe", { action: "research" }),
			call("wait", "wait_for_answers", {}),
			call("stats", "queue_probe", { action: "stats" }),
			assistantMessage([text("Queue verification complete.")]),
		],
	}).run(
		"Queue questions and continue independent research, then wait for the answers."
	);
	for (const id of ["first-form", "second-form", "research", "wait", "stats"]) {
		assert.equal(getToolExecution(result, id).isError, false);
	}
	assert(getToolResultText(result, "first-form").includes("Queued ask_user"));
	assert.deepEqual(
		getToolExecutionDetails(getToolExecution(result, "research")),
		{ activeForms: 1, blocked: [], readSucceeded: true }
	);
	const wait = getToolExecutionDetails(getToolExecution(result, "wait")) as {
		results: Array<{ requestId: string }>;
	};
	assert.deepEqual(
		wait.results.map((answer) => answer.requestId),
		["second-form"]
	);
	const stats = getToolExecutionDetails(getToolExecution(result, "stats")) as {
		answerMessages: number;
		activeForms: number;
		blocked: Array<{ active: boolean }>;
	};
	assert.equal(stats.answerMessages, 1);
	assert.equal(stats.activeForms, 0);
	assert.deepEqual(
		stats.blocked.map((event) => event.active),
		[true, false]
	);
	assert(getProviderSystemPrompt(result).includes("background: true"));
	assert(getProviderSystemPrompt(result).includes("Never guess answers"));
	assert(result.tuiRenderedOutput.includes("Queue verification complete"));
});
