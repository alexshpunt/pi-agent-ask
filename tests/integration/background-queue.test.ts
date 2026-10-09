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
		{
			activeForms: 1,
			blocked: [{ active: true, label: "Waiting for user response" }],
			readSucceeded: true,
		}
	);
	const wait = getToolExecutionDetails(getToolExecution(result, "wait")) as {
		results: Array<{ requestId: string }>;
	};
	assert.deepEqual(
		wait.results.map((answer) => answer.requestId),
		[
			(
				getToolExecutionDetails(getToolExecution(result, "second-form")) as {
					requestId: string;
				}
			).requestId,
		]
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
		[true, false, true, false]
	);
	assert(getProviderSystemPrompt(result).includes("background: true"));
	assert(getProviderSystemPrompt(result).includes("Never guess answers"));
	assert(JSON.stringify(result.providerRequests).includes("Q1 [first]: Yes"));
	assert(
		JSON.stringify(result.providerRequests).includes(
			"[first] Q1: Choose first?"
		)
	);
	assert(
		getToolResultText(result, "wait").includes("[second] Q1: Choose second?")
	);
	assert(result.tuiRenderedOutput.includes("Answers received"));
	assert(result.tuiRenderedOutput.includes("Choose first?"));
	assert(result.tuiRenderedOutput.includes("→ Yes"));
	assert(!result.tuiRenderedOutput.includes("[ask:background-answer]"));
	assert(result.tuiRenderedOutput.includes("Queue verification complete"));
});

test("real Pi delivers an idle answer once across turn_start and later boundaries", {
	timeout: 60_000,
}, async () => {
	const result = await new PiIntegrationTest({
		testName: "background-idle-delivery",
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: root,
		isolateUserResources: true,
		extensions: [
			fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			fileURLToPath(
				new URL("../fixtures/background-driver.ts", import.meta.url)
			),
		],
		tools: ["ask_user", "queue_probe"],
		rawMode: false,
		conversation: [
			call("idle-form", "ask_user", form("idle")),
			call("arm-idle", "queue_probe", { action: "answer_idle" }),
			assistantMessage([text("Waiting for the background answer.")]),
			call("after-wake", "queue_probe", { action: "stats" }),
			call("after-boundary", "queue_probe", { action: "stats" }),
			assistantMessage([text("Idle answer verification complete.")]),
		],
	}).run(
		"Queue a form, finish the turn, then check the answer after the idle wake."
	);
	for (const id of ["after-wake", "after-boundary"]) {
		const stats = getToolExecutionDetails(getToolExecution(result, id)) as {
			answerMessages: number;
		};
		assert.equal(stats.answerMessages, 1);
	}
	const snapshot = result.traceEvents
		.filter((event) => event.type === "session_snapshot")
		.at(-1);
	assert(Array.isArray(snapshot?.branch));
	const answers = snapshot.branch.filter(
		(entry) =>
			entry.type === "custom_message" &&
			entry.customType === "ask:background-answer"
	);
	assert.equal(answers.length, 1);
	assert(result.tuiRenderedOutput.includes("Answers received"));
	assert(result.tuiRenderedOutput.includes("Choose idle?"));
	assert(result.tuiRenderedOutput.includes("→ Yes"));
	assert(JSON.stringify(result.providerRequests).includes("Q1 [idle]: Yes"));
});
