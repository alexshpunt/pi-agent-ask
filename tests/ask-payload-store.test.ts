import assert from "node:assert/strict";
import test from "node:test";
import {
	appendAskPayload,
	findPayloadForSourceEntry,
} from "../src/ask-payload-store.ts";
import type { AskParams } from "../src/types.ts";

const params: AskParams = {
	questions: [
		{
			id: "goal",
			prompt: "Goal?",
			options: [{ value: "a", label: "A", recommended: true }],
		},
	],
};
const custom = (data: unknown) => ({
	type: "custom",
	customType: "ask:payload",
	data,
});
const ctx = (branch: unknown[]) =>
	({ sessionManager: { getBranch: () => branch } }) as never;

test("stored tool payloads keep the loaded context snapshot for recovery", () => {
	const entries: unknown[] = [];
	const previewParams: AskParams = {
		questions: [
			{
				id: "preview",
				prompt: "Choose",
				context: "Saved file text",
				options: [{ value: "doc", label: "Document" }],
			},
		],
	};
	appendAskPayload(
		{
			appendEntry(_type: string, data: unknown) {
				entries.push(custom(data));
			},
		} as never,
		{ params: previewParams, source: "tool", sourceEntryId: "call-1" }
	);
	assert.deepEqual(
		findPayloadForSourceEntry(ctx(entries), "call-1", "tool")?.params,
		previewParams
	);
	assert.equal(
		findPayloadForSourceEntry(ctx(entries), "other-call", "tool"),
		undefined
	);
});

test("payloads saved with option previews recover as question context", () => {
	const legacy = {
		version: 1,
		source: "tool",
		sourceEntryId: "call-1",
		timestamp: 1,
		params: {
			questions: [
				{
					id: "doc",
					prompt: "Accept this task?",
					type: "preview",
					options: [{ value: "accept", label: "Accept", preview: "Task body" }],
				},
			],
		},
	};
	assert.deepEqual(
		findPayloadForSourceEntry(ctx([custom(legacy)]), "call-1", "tool")?.params,
		{
			questions: [
				{
					id: "doc",
					prompt: "Accept this task?",
					type: "single",
					context: "Task body",
					options: [{ value: "accept", label: "Accept" }],
				},
			],
		}
	);
});

test("recovery ignores invalid payloads and unrelated source entries", () => {
	const valid = {
		version: 1,
		source: "tool",
		sourceEntryId: "call-1",
		params,
		timestamp: 1,
	};
	const branch = [
		custom(valid),
		custom({ ...valid, params: { questions: [] } }),
		custom({ ...valid, params: {} }),
		custom({ ...valid, sourceEntryId: "other" }),
	];
	assert.deepEqual(
		findPayloadForSourceEntry(ctx(branch), "call-1", "tool"),
		valid
	);
	assert.equal(
		findPayloadForSourceEntry(ctx(branch), "missing", "tool"),
		undefined
	);
});
