import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	getToolResultText,
	PiIntegrationTest,
	type PiIntegrationTestOptions,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";
import type { NonModalSnapshot } from "../fixtures/non-modal-driver.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});
const probe = (id: string, action: string) =>
	call(id, "non_modal_probe", { action });
const form = (id: string, questionIds: string[] = [id]) =>
	call(id, "ask_user", {
		background: true,
		title: id,
		questions: questionIds.map((questionId) => ({
			id: questionId,
			prompt: `Choose ${questionId}?`,
			options: [{ value: "yes", label: "Yes" }],
		})),
	});

async function run(
	name: string,
	conversation: PiIntegrationTestOptions["conversation"]
) {
	await mkdir(join(root, ".tmp"), { recursive: true });
	const workspace = await mkdtemp(join(root, ".tmp", "non-modal-"));
	try {
		return await new PiIntegrationTest({
			testName: name,
			...(process.env.PI_COMMAND === undefined
				? {}
				: { piCommand: process.env.PI_COMMAND }),
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd: workspace,
			isolateUserResources: true,
			extensions: [
				fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
				fileURLToPath(
					new URL("../fixtures/non-modal-driver.ts", import.meta.url)
				),
			],
			tools: ["ask_user", "wait_for_answers", "non_modal_probe"],
			rawMode: false,
			tuiSize: { cols: 80, rows: 24 },
			conversation,
		}).run(
			"Exercise the non-modal question queue and preserve unanswered questions."
		);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}

function snapshot(
	result: Awaited<ReturnType<typeof run>>,
	id: string
): NonModalSnapshot {
	const execution = getToolExecution(result, id);
	assert.equal(execution.isError, false, getToolResultText(result, id));
	return getToolExecutionDetails(execution) as NonModalSnapshot;
}

test("queued questions preserve native typing and D skips only the current question", {
	timeout: 60_000,
}, async () => {
	const result = await run("non-modal-focus-and-skip", [
		probe("draft", "draft_message"),
		form("first", ["q1", "q2"]),
		form("second", ["q3"]),
		probe("before-skip", "snapshot"),
		probe("skip", "skip_first"),
		probe("finish-second", "answer_focused"),
		form("later", ["q4"]),
		probe("after-empty", "type_after_empty"),
		assistantMessage([text("Non-modal skip verification complete.")]),
	]);
	const before = snapshot(result, "before-skip");
	assert.equal(before.normalInput, "ordinary-editor-draft");
	assert(before.panel.includes("Choose q1?"));
	assert.deepEqual(before.blocked, []);
	assert.equal(before.pendingRequestIds.length, 2);
	const after = snapshot(result, "skip");
	assert.equal(after.normalInput, "ordinary-editor-draft-still-typing");
	assert.equal(after.pendingRequestIds.length, 1);
	assert.deepEqual(after.activeToolCalls, ["second"]);
	assert.equal(after.completed.length, 1);
	const answer = after.completed[0].result;
	assert.equal(answer.cancelled, false);
	assert.equal("skippedQuestionIds" in answer, true);
	assert.deepEqual(
		(answer as typeof answer & { skippedQuestionIds: string[] })
			.skippedQuestionIds,
		["q1"]
	);
	assert.equal(answer.answers.q1, undefined);
	assert.deepEqual(answer.answers.q2.values, ["yes"]);
	assert.deepEqual(
		answer.questions.map((question) => question.id),
		["q1", "q2"]
	);
	assert.deepEqual(after.blocked, []);
	const later = snapshot(result, "after-empty");
	assert.equal(
		later.normalInput,
		"ordinary-editor-draft-still-typing-after-empty"
	);
	assert.deepEqual(later.activeToolCalls, ["later"]);
	assert(result.tuiRenderedOutput.includes("(skipped)"));
	assert(
		result.tuiRenderedOutput.includes("Non-modal skip verification complete")
	);
});

test("Escape releases a wait while drafts and newly queued requests stay deferred", {
	timeout: 60_000,
}, async () => {
	const result = await run("non-modal-defer-and-reopen", [
		probe("draft", "draft_message"),
		form("first"),
		probe("arm", "arm_escape"),
		call("wait", "wait_for_answers", {}),
		form("second"),
		probe("hidden", "snapshot"),
		probe("reopened", "reopen"),
		probe("answer", "answer"),
		probe("after-answer", "snapshot"),
		assistantMessage([text("Non-modal defer verification complete.")]),
	]);
	const first = getToolExecutionDetails(getToolExecution(result, "first")) as {
		requestId: string;
	};
	assert.equal(getToolExecution(result, "wait").isError, false);
	assert.deepEqual(getToolExecutionDetails(getToolExecution(result, "wait")), {
		status: "deferred",
		reason: "hidden",
		requestIds: [first.requestId],
		pendingRequestIds: [first.requestId],
		results: [],
	});
	const hidden = snapshot(result, "hidden");
	assert.equal(hidden.hidden, true);
	assert.equal(hidden.panel, "");
	assert.equal(hidden.normalInput, "ordinary-editor-draft");
	assert.equal(hidden.draftText, "saved-answer-draft");
	assert.equal(hidden.pendingRequestIds.length, 2);
	assert.deepEqual(hidden.completed, []);
	assert.deepEqual(hidden.blocked, [
		{ active: true, label: "Waiting for user answers" },
		{ active: false },
	]);
	const reopened = snapshot(result, "reopened");
	assert.equal(reopened.hidden, false);
	assert(reopened.panel.includes("saved-answer-draft"));
	const after = snapshot(result, "after-answer");
	assert.equal(after.pendingRequestIds.length, 1);
	assert.equal(after.completed.length, 1);
	assert.equal(after.completed[0].result.cancelled, false);
	assert.equal(after.answerMessages, 1);
	assert(result.tuiRenderedOutput.includes("Questions deferred"));
	assert(
		result.tuiRenderedOutput.includes("Non-modal defer verification complete")
	);
});

test("ordinary terminal input releases a wait without answering or cancelling the queue", {
	timeout: 60_000,
}, async () => {
	const result = await run("non-modal-message-releases-wait", [
		form("first"),
		probe("arm", "arm_message"),
		call("wait", "wait_for_answers", {}),
		probe("after-message", "snapshot"),
		assistantMessage([
			text("The new message was handled; questions remain queued."),
		]),
	]);
	const first = getToolExecutionDetails(getToolExecution(result, "first")) as {
		requestId: string;
	};
	assert.equal(getToolExecution(result, "wait").isError, false);
	assert.deepEqual(getToolExecutionDetails(getToolExecution(result, "wait")), {
		status: "deferred",
		reason: "user_message",
		requestIds: [first.requestId],
		pendingRequestIds: [first.requestId],
		results: [],
	});
	const after = snapshot(result, "after-message");
	assert.equal(after.hidden, true);
	assert.equal(after.panel, "");
	assert.deepEqual(after.pendingRequestIds, [first.requestId]);
	assert.deepEqual(after.completed, []);
	assert.equal(after.answerMessages, 0);
	const message = "Please keep the questions and discuss this message instead.";
	assert(after.userInputs.includes(message));
	assert(JSON.stringify(result.providerRequests).includes(message));
	assert(result.tuiRenderedOutput.includes("Questions deferred"));
	assert(result.tuiRenderedOutput.includes("The new message was handled"));
});

test("a foreground completion keeps Herdr blocked until the separate answer wait ends", {
	timeout: 60_000,
}, async () => {
	const result = await run("non-modal-overlapping-waits", [
		form("pending"),
		probe("arm-overlap", "arm_overlap"),
		assistantMessage(
			[
				toolCall({
					id: "overlap-wait",
					name: "wait_for_answers",
					arguments: {},
				}),
				toolCall({
					id: "overlap-foreground",
					name: "ask_user",
					arguments: {
						questions: [
							{
								id: "foreground",
								prompt: "Foreground choice?",
								options: [{ value: "yes", label: "Yes" }],
							},
						],
					},
				}),
			],
			{ stopReason: "toolUse" }
		),
		probe("after-overlap", "snapshot"),
		assistantMessage([text("Both waits completed.")]),
	]);
	assert.equal(getToolExecution(result, "overlap-wait").isError, false);
	assert.equal(getToolExecution(result, "overlap-foreground").isError, false);
	const after = snapshot(result, "after-overlap");
	assert.deepEqual(after.blocked, [
		{ active: true, label: "Waiting for user answers" },
		{ active: true, label: "Waiting for user response" },
		{ active: true, label: "Waiting for user answers" },
		{ active: false },
	]);
});

test("a real terminal resize keeps a tall questionnaire bounded and ordinary input usable", {
	timeout: 60_000,
	skip:
		process.platform === "win32" &&
		"This native PTY resize check uses stty on its own test terminal",
}, async () => {
	const result = await run("non-modal-terminal-resize", [
		probe("draft", "draft_message"),
		call("tall", "ask_user", {
			background: true,
			questions: [
				{
					id: "tall",
					prompt: "Choose a row?",
					options: Array.from({ length: 25 }, (_, index) => ({
						value: String(index),
						label: `Row ${index + 1}`,
					})),
				},
			],
		}),
		probe("resized", "resize"),
		assistantMessage([text("The resized terminal remains usable.")]),
	]);
	const after = snapshot(result, "resized");
	assert.deepEqual(after.terminalSize, { cols: 60, rows: 18 });
	assert.equal(after.normalInput, "ordinary-editor-draft-resized");
	assert(after.panelRows <= 8);
	assert(after.panel.includes("PgUp/PgDn"));
	assert.equal(after.pendingRequestIds.length, 1);
	assert.deepEqual(after.completed, []);
});
