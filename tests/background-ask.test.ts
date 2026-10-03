import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { registerAskTool } from "../src/ask-tool.ts";
import { createBackgroundAskRuntime } from "../src/background-ask.ts";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import type { AskParams, AskResult } from "../src/types.ts";
import { registerWaitForAnswersTool } from "../src/wait-for-answers-tool.ts";

getAskConfigStore().setConfig({
	...DEFAULT_ASK_CONFIG,
	notifications: { ...DEFAULT_ASK_CONFIG.notifications, enabled: false },
});

const params: AskParams = {
	questions: [
		{
			id: "choice",
			prompt: "Choose?",
			options: [{ value: "yes", label: "Yes" }],
		},
	],
};
const answer: AskResult = {
	cancelled: false,
	mode: "submit",
	questions: [{ id: "choice", label: "Q1", prompt: "Choose?", type: "single" }],
	answers: { choice: { values: ["yes"], labels: ["Yes"], indices: [1] } },
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
	const branch: any[] = [];
	const tools = new Map<string, any>();
	const messages: any[] = [];
	const events: any[] = [];
	const forms: Array<(result: AskResult) => void> = [];
	const handlers = new Map<string, (...args: any[]) => any>();
	let idle = false;
	let signal: AbortSignal | undefined;
	const pi = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		appendEntry(customType: string, data: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		sendMessage(message: any) {
			messages.push(message);
			branch.push({ type: "custom_message", ...message });
		},
		on(name: string, handler: (...args: any[]) => any) {
			handlers.set(name, handler);
		},
		events: {
			emit(channel: string, data: unknown) {
				events.push({ channel, data });
			},
		},
	};
	const ctx = {
		cwd: process.cwd(),
		mode: "tui",
		isIdle: () => idle,
		get signal() {
			return signal;
		},
		sessionManager: { getBranch: () => branch },
		ui: {
			custom(factory: any) {
				return new Promise<AskResult>((resolve) => {
					let component: any;
					const done = (result: AskResult) => {
						component?.dispose?.();
						resolve(result);
					};
					component = factory(
						{ requestRender: () => undefined },
						{ fg: (_color: string, text: string) => text },
						{},
						done
					);
					forms.push(done);
				});
			},
			setStatus: () => undefined,
			notify: () => undefined,
		},
	};
	const runtime = createBackgroundAskRuntime(pi as never);
	const boundary = () => {
		const result = handlers.get("turn_end")?.({ entries: [] }, ctx);
		for (const entry of result?.entries ?? []) {
			branch.push(entry);
			messages.push(entry);
		}
		return result;
	};
	return {
		branch,
		messages,
		pi,
		tools,
		events,
		forms,
		handlers,
		ctx,
		runtime,
		boundary,
		setSignal(value: AbortSignal | undefined) {
			signal = value;
		},
		setIdle(value: boolean) {
			idle = value;
		},
	};
}

test("background receipts return before answers and forms run in FIFO order", async () => {
	const h = harness();
	const first = h.runtime.enqueue("first", params, h.ctx as never, false);
	const second = h.runtime.enqueue("second", params, h.ctx as never, false);
	assert.equal(first.status, "queued");
	assert.notEqual(first.requestId, second.requestId);
	await tick();
	assert.equal(h.forms.length, 1);
	assert.deepEqual(h.events, []);
	h.forms[0](answer);
	await tick();
	assert.equal(h.forms.length, 2);
	assert.equal(h.messages.length, 0);
	h.boundary();
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0].details.requestId, first.requestId);
	h.boundary();
	assert.equal(h.messages.length, 1);
	h.forms[1](answer);
	await tick();
	h.boundary();
	assert.equal(h.messages.length, 2);
	h.runtime.dispose();
});

test("wait returns the remaining results without also sending them as messages", async () => {
	const h = harness();
	const receipt = h.runtime.enqueue("pending", params, h.ctx as never, false);
	await tick();
	let settled = false;
	const wait = h.runtime.wait(undefined).then((value) => {
		settled = true;
		return value;
	});
	await tick();
	assert.equal(settled, false);
	h.forms[0](answer);
	const result = await wait;
	assert.equal(result.status, "complete");
	assert.deepEqual(result.results, [
		{ requestId: receipt.requestId, result: answer },
	]);
	h.boundary();
	assert.equal(h.messages.length, 0);
	h.runtime.dispose();
});

test("aborting a wait leaves the question queued and restores async delivery", async () => {
	const h = harness();
	h.runtime.enqueue("pending", params, h.ctx as never, false);
	await tick();
	const abort = new AbortController();
	const wait = h.runtime.wait(abort.signal);
	abort.abort();
	await assert.rejects(wait, { name: "AbortError" });
	h.forms[0]({ ...answer, cancelled: true, answers: {} });
	await tick();
	h.boundary();
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0].details.result.cancelled, true);
	h.runtime.dispose();
});

test("recovery reopens pending forms but not answered forms or delivered results", async () => {
	const h = harness();
	h.runtime.enqueue("done", params, h.ctx as never, false);
	h.runtime.enqueue("pending", params, h.ctx as never, false);
	await tick();
	h.forms[0](answer);
	await tick();
	h.boundary();
	h.runtime.restore(h.ctx as never);
	await tick();
	assert.equal(h.forms.length, 3);
	h.boundary();
	assert.equal(h.messages.length, 1);
	// An old surface finishing after restore must not write into the new branch.
	h.forms[1]({ ...answer, cancelled: true });
	await tick();
	h.boundary();
	assert.equal(h.messages.length, 1);
	h.forms[2](answer);
	await tick();
	h.boundary();
	assert.equal(h.messages.length, 2);
	h.runtime.dispose();
});

test("idle answers wake the agent and a wait on an empty queue finishes immediately", async () => {
	const h = harness();
	assert.deepEqual(await h.runtime.wait(undefined), {
		status: "complete",
		requestIds: [],
		results: [],
	});
	h.setIdle(true);
	h.runtime.enqueue("idle", params, h.ctx as never, false);
	await tick();
	h.forms[0](answer);
	await tick();
	assert.equal(h.messages.length, 1);
	h.runtime.dispose();
});

test("registered ask_user returns a typed receipt and rejects invalid forms before queueing", async () => {
	const h = harness();
	registerAskTool(h.pi as never, undefined, h.runtime);
	const tool = h.tools.get("ask_user");
	const result = await tool.execute(
		"api",
		{ ...params, background: true },
		undefined,
		undefined,
		h.ctx
	);
	assert.equal(Value.Check(tool.outputSchema, result.structuredContent), true);
	assert.equal(result.details.status, "queued");
	assert.ok(result.content[0].text.includes("This is not an answer"));
	assert.ok(
		tool.promptGuidelines.some((line: string) => line.includes("Never guess"))
	);
	await tick();
	const invalid = await tool.execute(
		"bad",
		{ background: true, questions: [] },
		undefined,
		undefined,
		h.ctx
	);
	assert.equal(invalid.details.error.kind, "invalid_input");
	assert.equal(h.runtime.pendingCount(), 1);
	h.runtime.dispose();
});

test("wait includes forms enqueued while it is waiting", async () => {
	const h = harness();
	h.runtime.enqueue("first", params, h.ctx as never, false);
	await tick();
	let settled = false;
	const waiting = h.runtime.wait(undefined).then((result) => {
		settled = true;
		return result;
	});
	h.runtime.enqueue("second", params, h.ctx as never, false);
	h.forms[0](answer);
	await tick();
	assert.equal(settled, false);
	h.forms[1](answer);
	assert.deepEqual((await waiting).requestIds, ["first", "second"]);
	assert.equal(h.messages.length, 0);
	h.runtime.dispose();
});

test("changing branches abandons old surfaces without copying their answers", async () => {
	const h = harness();
	h.runtime.enqueue("old-branch", params, h.ctx as never, false);
	await tick();
	h.branch.length = 0;
	h.runtime.restore(h.ctx as never);
	h.forms[0](answer);
	await tick();
	h.boundary();
	assert.deepEqual(h.branch, []);
	assert.equal(h.runtime.pendingCount(), 0);
	assert.equal(h.messages.length, 0);
	h.runtime.dispose();
});

test("a persisted direct wait result prevents delivery after recovery", async () => {
	const h = harness();
	h.runtime.enqueue("saved", params, h.ctx as never, false);
	await tick();
	const waiting = h.runtime.wait(undefined);
	h.forms[0](answer);
	const result = await waiting;
	h.branch.push({
		type: "message",
		message: {
			role: "toolResult",
			toolName: "wait_for_answers",
			isError: false,
			details: result,
		},
	});
	h.runtime.restore(h.ctx as never);
	await tick();
	h.boundary();
	assert.equal(h.forms.length, 1);
	assert.equal(h.messages.length, 0);
	assert.deepEqual((await h.runtime.wait(undefined)).results, []);
	h.runtime.dispose();
});

test("wait tool reports blocking only for pending forms and clears it on abort", async () => {
	const h = harness();
	registerWaitForAnswersTool(h.pi as never, h.runtime);
	const tool = h.tools.get("wait_for_answers");
	assert.equal(tool.exposure, "model-only");
	const empty = await tool.execute("empty", {}, undefined, undefined, h.ctx);
	assert.equal(Value.Check(tool.outputSchema, empty.structuredContent), true);
	assert.equal(h.events.length, 0);
	h.runtime.enqueue("pending", params, h.ctx as never, false);
	await tick();
	const abort = new AbortController();
	const waiting = tool.execute("wait", {}, abort.signal, undefined, h.ctx);
	abort.abort();
	await assert.rejects(waiting, { name: "AbortError" });
	assert.deepEqual(
		h.events.map((event) => event.data.active),
		[true, false]
	);
	assert.equal(h.runtime.pendingCount(), 1);
	h.runtime.dispose();
});

test("a broken blocked-state listener does not break answer delivery", async () => {
	const h = harness();
	registerWaitForAnswersTool(h.pi as never, h.runtime);
	h.pi.events.emit = () => {
		throw new Error("listener failure");
	};
	h.runtime.enqueue("pending", params, h.ctx as never, false);
	await tick();
	const waiting = h.tools
		.get("wait_for_answers")
		.execute("wait", {}, undefined, undefined, h.ctx);
	h.forms[0](answer);
	assert.equal((await waiting).details.results[0].result.cancelled, false);
	h.runtime.dispose();
});

test("recovering multiple ready answers wakes one idle turn and uses its boundary for the rest", async () => {
	const h = harness();
	h.runtime.enqueue("one", params, h.ctx as never, false);
	h.runtime.enqueue("two", params, h.ctx as never, false);
	await tick();
	h.forms[0](answer);
	await tick();
	h.forms[1](answer);
	await tick();
	h.setIdle(true);
	h.runtime.restore(h.ctx as never);
	await tick();
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0].details.requestId, "one");
	h.setIdle(false);
	h.runtime.reconcileDelivery(h.ctx as never);
	h.boundary();
	assert.deepEqual(
		h.messages.map((message) => message.details.requestId),
		["one", "two"]
	);
	h.runtime.dispose();
});

test("an active agent signal prevents an idle wake during a transient idle report", async () => {
	const h = harness();
	h.setIdle(true);
	h.setSignal(new AbortController().signal);
	h.runtime.enqueue("active-run", params, h.ctx as never, false);
	await tick();
	h.forms[0](answer);
	await tick();
	assert.equal(h.messages.length, 0);
	h.setSignal(undefined);
	h.handlers.get("agent_settled")?.({}, h.ctx);
	assert.equal(h.messages.length, 1);
	h.runtime.dispose();
});
