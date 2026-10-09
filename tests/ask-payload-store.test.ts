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

test("stored tool payloads keep the original preview snapshot for recovery", () => {
	const entries: unknown[] = [];
	const previewParams = {
		questions: [
			{
				id: "preview",
				prompt: "Choose",
				type: "preview" as const,
				options: [
					{ value: "doc", label: "Document", preview: "Saved file text" },
				],
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
	assert.equal(findPayloadForSourceEntry(ctx(branch), "call-1", "tool"), valid);
	assert.equal(
		findPayloadForSourceEntry(ctx(branch), "missing", "tool"),
		undefined
	);
});
