import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	appendAskHistoryCompletion,
	appendAskHistoryRequest,
	readAskHistory,
	selectAskHistory,
} from "../src/ask-history.ts";
import { exportAskHistory } from "../src/ask-history-export.ts";
import { createInitialState } from "../src/state/create.ts";
import type { AskResult } from "../src/types.ts";

const MISSING_KEY_RE = /not found/;
const EMPTY_SELECTION_RE = /at least one/;
const EXISTING_FILE_RE = /exist/i;
const state = createInitialState({
	title: "Choose scope",
	questions: [
		{
			id: "scope",
			prompt: "Which **scope**?",
			type: "preview",
			options: [
				{
					value: "small",
					label: "Small",
					description: "Keep it small",
					preview: "Original preview\nSecond line",
				},
			],
		},
	],
});
const answer: AskResult = {
	cancelled: false,
	mode: "submit",
	questions: [
		{ id: "scope", label: "Q1", prompt: "Which **scope**?", type: "preview" },
	],
	answers: {
		scope: {
			values: ["small", "custom"],
			labels: ["Small", "Custom text"],
			indices: [1, 2],
			customText: "Custom text",
			note: "Keep this note",
			optionNotes: { small: "Option note" },
		},
	},
};
function journal(manager = SessionManager.inMemory()) {
	return {
		manager,
		pi: {
			appendEntry: (type: string, data: unknown) => {
				manager.appendCustomEntry(type, data);
			},
		},
	};
}

test("request keys do not collide when question and tool call IDs are repeated", () => {
	const { manager, pi } = journal();
	const first = appendAskHistoryRequest(pi, "reused-call", state, false);
	appendAskHistoryCompletion(pi, { requestId: first, result: answer });
	const second = appendAskHistoryRequest(pi, "reused-call", state, true);
	assert.notEqual(first, second);
	const records = readAskHistory(manager.getBranch());
	assert.deepEqual(
		records.map((record) => [
			record.requestId,
			record.questionId,
			record.status,
		]),
		[
			[first, "scope", "answered"],
			[second, "scope", "waiting"],
		]
	);
	assert.deepEqual(records[0].answer, answer.answers.scope);
	assert.equal(
		records[0].question.options[0].preview,
		"Original preview\nSecond line"
	);
	assert.equal(records[1].background, true);
	assert.equal(records[0].question.label, "Q1");
});

test("compaction and branch switches preserve only the selected history", () => {
	const { manager, pi } = journal();
	const common = appendAskHistoryRequest(pi, "common", state, false);
	appendAskHistoryCompletion(pi, { requestId: common, result: answer });
	const ancestor = manager.getLeafId();
	assert(ancestor);
	const left = appendAskHistoryRequest(pi, "left", state, true);
	const leftLeaf = manager.getLeafId();
	assert(leftLeaf);
	manager.branch(ancestor);
	const right = appendAskHistoryRequest(pi, "right", state, true);
	manager.appendCompaction(
		"Summary without answers",
		manager.getLeafId(),
		1000
	);
	const branch = manager.getBranch();
	assert.deepEqual(
		readAskHistory(branch).map((record) => record.requestId),
		[common, right]
	);
	assert.throws(
		() =>
			selectAskHistory(readAskHistory(branch), [
				{ requestId: left, questionId: "scope" },
			]),
		MISSING_KEY_RE
	);
	manager.branch(leftLeaf);
	assert.deepEqual(
		readAskHistory(manager.getBranch()).map((record) => record.requestId),
		[common, left]
	);
	assert.deepEqual(readAskHistory(SessionManager.inMemory().getBranch()), []);
});

test("notes, skipped questions, cancellation, clarification and errors are distinct", () => {
	const { manager, pi } = journal();
	const add = (result?: AskResult, error?: string) => {
		const requestId = appendAskHistoryRequest(pi, "call", state, false);
		if (result || error) {
			appendAskHistoryCompletion(pi, { requestId, result, error });
		}
	};
	add({
		...answer,
		answers: {
			scope: { values: [], labels: [], indices: [], note: "Not a decision" },
		},
	});
	add({ ...answer, cancelled: true, answers: {} });
	add({
		...answer,
		mode: "elaborate",
		elaboration: {
			instruction: "Explain",
			nextAction: "clarify",
			items: [
				{
					target: { kind: "question" },
					question: {
						...answer.questions[0],
						options: state.questions[0].options,
					},
					answered: true,
					answer: answer.answers.scope,
					note: "Why?",
				},
			],
		},
	});
	add(undefined, "UI disconnected");
	add();
	const records = readAskHistory(manager.getBranch());
	assert.deepEqual(
		records.map((record) => record.status),
		["skipped", "cancelled", "clarification", "error", "waiting"]
	);
	assert.equal(records[0].answer?.note, "Not a decision");
	assert.equal(records[2].elaboration?.[0].note, "Why?");
	assert.equal(records[3].error, "UI disconnected");
	assert.throws(() => selectAskHistory(records, []), EMPTY_SELECTION_RE);
});

test("a missing answer never resolves an inherited object property", () => {
	const { manager, pi } = journal();
	const requestId = appendAskHistoryRequest(
		pi,
		"call",
		{ ...state, questions: [{ ...state.questions[0], id: "constructor" }] },
		false
	);
	appendAskHistoryCompletion(pi, {
		requestId,
		result: { ...answer, answers: {} },
	});
	assert.equal(readAskHistory(manager.getBranch())[0].status, "skipped");
});
test("session file is sufficient after reopening without an in-memory index", async () => {
	await mkdir(".tmp", { recursive: true });
	const directory = await mkdtemp(join(process.cwd(), ".tmp/history-session-"));
	try {
		const manager = SessionManager.create(directory, directory);
		manager.appendMessage({
			role: "assistant",
			api: "openai-completions",
			provider: "test",
			model: "test",
			content: [{ type: "text", text: "Started" }],
			stopReason: "stop",
			timestamp: Date.now(),
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		});
		const { pi } = journal(manager);
		const requestId = appendAskHistoryRequest(pi, "call", state, false);
		appendAskHistoryCompletion(pi, { requestId, result: answer });
		const file = manager.getSessionFile();
		assert(file);
		const reopened = SessionManager.open(file);
		assert.deepEqual(
			readAskHistory(reopened.getBranch()),
			readAskHistory(manager.getBranch())
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("selected Markdown export keeps exact text, fails closed and never overwrites", async () => {
	await mkdir(".tmp", { recursive: true });
	const directory = await mkdtemp(join(process.cwd(), ".tmp/history-export-"));
	try {
		const { manager, pi } = journal();
		const first = appendAskHistoryRequest(pi, "first", state, false);
		appendAskHistoryCompletion(pi, { requestId: first, result: answer });
		appendAskHistoryRequest(
			pi,
			"second",
			{
				...state,
				questions: [{ ...state.questions[0], prompt: "Do not export this" }],
			},
			false
		);
		const records = readAskHistory(manager.getBranch());
		const selected = selectAskHistory(records, [
			{ requestId: first, questionId: "scope" },
		]);
		const path = join(directory, "selected.md");
		const result = await exportAskHistory(path, directory, selected);
		assert.equal(result.path, path);
		const content = await readFile(path, "utf8");
		for (const text of [
			first,
			"Which **scope**?",
			"Keep it small",
			"Original preview\nSecond line",
			"Custom text",
			"Keep this note",
			"Option note",
			"answered",
		]) {
			assert(content.includes(text), text);
		}
		assert(!content.includes("Do not export this"));
		assert.throws(
			() =>
				selectAskHistory(records, [
					{ requestId: first, questionId: "scope" },
					{ requestId: "missing", questionId: "scope" },
				]),
			MISSING_KEY_RE
		);
		await writeFile(path, "Keep existing data");
		await assert.rejects(
			exportAskHistory(path, directory, selected),
			EXISTING_FILE_RE
		);
		assert.equal(await readFile(path, "utf8"), "Keep existing data");
		await assert.rejects(
			exportAskHistory(
				join(directory, "absent", "export.md"),
				directory,
				selected
			)
		);
		assert.equal(readAskHistory(manager.getBranch()).length, 2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
