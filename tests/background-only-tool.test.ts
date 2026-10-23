import assert from "node:assert/strict";
import test from "node:test";
import { registerAskTool } from "../src/ask-tool.ts";
import { registerWaitForAnswersTool } from "../src/wait-for-answers-tool.ts";

const QUEUE_UNAVAILABLE = /Background question queue is unavailable/;
const WAIT_UNAVAILABLE = /unavailable in background-only mode/;
const form = {
	questions: [
		{
			id: "choice",
			prompt: "Choose?",
			options: [{ value: "yes", label: "Yes" }],
		},
	],
};

function register(initialBackgroundOnly = true, queue?: unknown) {
	let backgroundOnly = initialBackgroundOnly;
	const tools: any[] = [];
	const entries: Array<{ type: string; data: any }> = [];
	const pi = {
		registerTool(tool: unknown) {
			tools.push(tool);
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
		events: {
			emit() {
				throw new Error("Must not negotiate synchronous UI");
			},
		},
	};
	registerAskTool(pi as never, undefined, queue as never, () => backgroundOnly);
	return {
		tool: tools[0],
		entries,
		setBackgroundOnly(value: boolean) {
			backgroundOnly = value;
		},
	};
}

test("background-only mode forces stale false calls into the queue and records their actual mode", async () => {
	let queued: unknown;
	const { tool, entries } = register(true, {
		enqueue(requestId: string, params: unknown) {
			queued = params;
			return {
				status: "queued",
				requestId,
				questionIds: ["choice"],
				pendingRequests: 1,
			};
		},
	});
	const response = await tool.execute(
		"stale-false",
		{ ...form, background: false },
		undefined,
		undefined,
		{ mode: "tui", cwd: process.cwd() }
	);
	assert.equal(response.structuredContent.status, "queued");
	assert.deepEqual(queued, { ...form, background: true });
	assert(
		entries.some(
			(entry) =>
				entry.type === "ask:history-request" && entry.data.background === true
		)
	);
});

test("a mode switch during asynchronous preparation cannot open a foreground form", async () => {
	const state = register(false, {
		enqueue(requestId: string) {
			return {
				status: "queued",
				requestId,
				questionIds: ["choice"],
				pendingRequests: 1,
			};
		},
	});
	const pending = state.tool.execute(
		"switch-during-prepare",
		{ ...form, background: false },
		undefined,
		undefined,
		{ mode: "tui", cwd: process.cwd() }
	);
	state.setBackgroundOnly(true);
	assert.equal((await pending).structuredContent.status, "queued");
});
test("background-only mode fails instead of opening foreground UI when its queue is missing", async () => {
	const { tool } = register();
	await assert.rejects(
		tool.execute("missing-queue", form, undefined, undefined, {
			mode: "tui",
			cwd: process.cwd(),
		}),
		QUEUE_UNAVAILABLE
	);
});

test("background-only non-TUI calls keep the cancelled fallback without external UI negotiation", async () => {
	const { tool } = register();
	const response = await tool.execute(
		"non-tui",
		{ ...form, background: false },
		undefined,
		undefined,
		{ mode: "rpc", cwd: process.cwd() }
	);
	assert.equal(response.structuredContent.cancelled, true);
	assert.deepEqual(response.structuredContent.answers, {});
});

test("a captured wait implementation also rejects after the policy changes", async () => {
	let backgroundOnly = false;
	let tool: any;
	registerWaitForAnswersTool(
		{
			registerTool(value: unknown) {
				tool = value;
			},
		} as never,
		{
			wait() {
				throw new Error("Must not start waiting");
			},
		} as never,
		() => backgroundOnly
	);
	backgroundOnly = true;
	await assert.rejects(
		tool.execute("old-wait", {}, undefined, undefined, { mode: "tui" }),
		WAIT_UNAVAILABLE
	);
});
