import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	getToolResultText,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";

import {
	ASK_ANSWER_MESSAGE,
	ASK_COMPLETED_ENTRY,
	ASK_QUEUED_ENTRY,
} from "../../src/background-ask-state.ts";

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

for (const waited of [false, true]) {
	test(`real Pi does not redeliver a ${waited ? "waited" : "background"} answer after session replacement drops queue records`, {
		timeout: 60_000,
	}, async () => {
		const result = await new PiIntegrationTest({
			testName: `background-replaced-${waited ? "waited" : "automatic"}`,
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
				call("retained-form", "ask_user", form("retained")),
				waited
					? call("first-wait", "wait_for_answers", {})
					: call("answer", "queue_probe", { action: "research" }),
				call("replace-session", "queue_probe", {
					action: "drop_queue_records",
				}),
				call("next-turn", "queue_probe", { action: "stats" }),
				call("repeat-wait", "wait_for_answers", {}),
				call("later-turn", "queue_probe", { action: "stats" }),
				assistantMessage([text("Verification complete.")]),
			],
		}).run(
			"Answer the form once, replace the session without queue records, and continue."
		);
		for (const id of [
			"replace-session",
			"next-turn",
			"repeat-wait",
			"later-turn",
		]) {
			assert.equal(getToolExecution(result, id).isError, false);
		}
		for (const id of ["replace-session", "next-turn", "later-turn"]) {
			const stats = getToolExecutionDetails(getToolExecution(result, id)) as {
				answerMessages: number;
				queueRecords: number;
			};
			assert.equal(stats.queueRecords, 0);
			assert.equal(stats.answerMessages, waited ? 0 : 1);
		}
		const repeated = getToolExecutionDetails(
			getToolExecution(result, "repeat-wait")
		) as {
			results: unknown[];
		};
		assert.deepEqual(repeated.results, []);
		if (waited) {
			const initial = getToolExecutionDetails(
				getToolExecution(result, "first-wait")
			) as {
				results: unknown[];
			};
			assert.equal(initial.results.length, 1);
		}
		const snapshot = result.traceEvents
			.filter((event) => event.type === "session_snapshot")
			.at(-1);
		assert(Array.isArray(snapshot?.branch));
		assert.equal(
			snapshot.branch.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === ASK_ANSWER_MESSAGE
			).length,
			waited ? 0 : 1
		);
		assert.equal(
			snapshot.branch.filter(
				(entry) =>
					entry.type === "custom" &&
					(entry.customType === ASK_QUEUED_ENTRY ||
						entry.customType === ASK_COMPLETED_ENTRY)
			).length,
			0
		);
	});
}

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
	const research = getToolExecutionDetails(
		getToolExecution(result, "research")
	) as {
		activeForms: number;
		blocked: Array<{ active: boolean }>;
		readSucceeded: boolean;
	};
	assert.equal(research.activeForms, 1);
	assert.equal(research.readSucceeded, true);
	assert.equal(research.blocked.at(-1)?.active, true);
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
		[true, false]
	);
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
