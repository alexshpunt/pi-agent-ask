import assert from "node:assert/strict";
import test from "node:test";
import {
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
	appendAskHistoryCompletion,
	appendAskHistoryRequest,
	readAskHistory,
} from "../src/ask-history.ts";
import { registerAskHistoryTools } from "../src/ask-history-tools.ts";
import { createInitialState } from "../src/state/create.ts";

const MISSING_KEY_RE = /not found/;
// The manager is real; only registration is captured so tool results can be checked directly.
test("list paging, answer filtering and read schemas keep keys and notes intact", async () => {
	const manager = SessionManager.inMemory();
	const tools = new Map<string, ToolDefinition>();
	registerAskHistoryTools({
		registerTool: (tool: ToolDefinition) => {
			tools.set(tool.name, tool);
		},
	} as never);
	const pi = {
		appendEntry: (type: string, data: unknown) => {
			manager.appendCustomEntry(type, data);
		},
	};
	const state = createInitialState({
		questions: [
			{
				id: "scope",
				prompt: "Choose scope",
				options: [{ value: "small", label: "Small" }],
			},
		],
	});
	const first = appendAskHistoryRequest(pi, "first", state, false);
	appendAskHistoryCompletion(pi, {
		requestId: first,
		result: {
			cancelled: false,
			mode: "submit",
			questions: [
				{ id: "scope", label: "Q1", type: "single", prompt: "Choose scope" },
			],
			answers: {
				scope: {
					values: ["small"],
					labels: ["Small"],
					indices: [1],
					note: "Known note",
				},
			},
		},
	});
	appendAskHistoryRequest(pi, "pending", state, true);
	const invoke = async (name: string, input: Record<string, unknown>) => {
		const tool = tools.get(name);
		assert(tool);
		const result = await tool.execute("probe", input, undefined, undefined, {
			cwd: process.cwd(),
			sessionManager: manager,
		} as never);
		assert(tool.outputSchema);
		assert.equal(
			Value.Check(tool.outputSchema, result.structuredContent),
			true
		);
		return result.structuredContent;
	};
	const page = (await invoke("list_ask_history", { limit: 1 })) as {
		total: number;
		nextOffset: number;
		records: Array<{ requestId: string; hasAnswer: boolean }>;
	};
	assert.equal(page.total, 2);
	assert.equal(page.nextOffset, 1);
	assert.equal(page.records[0].requestId, first);
	assert.equal(page.records[0].hasAnswer, true);
	const next = (await invoke("list_ask_history", {
		offset: page.nextOffset,
		limit: 1,
	})) as { records: Array<{ status: string }>; nextOffset?: number };
	assert.equal(next.records[0].status, "waiting");
	assert.equal(next.nextOffset, undefined);
	const filtered = (await invoke("list_ask_history", {
		answeredOnly: true,
		query: "KNOWN NOTE",
	})) as { total: number };
	assert.equal(filtered.total, 1);
	const read = (await invoke("read_ask_history", {
		requestId: first,
		questionId: "scope",
	})) as { record: { answer: { note: string } } };
	assert.equal(read.record.answer.note, "Known note");
	await assert.rejects(
		invoke("read_ask_history", { requestId: "missing", questionId: "scope" }),
		MISSING_KEY_RE
	);
	assert.equal(readAskHistory(manager.getBranch()).length, 2);
});
