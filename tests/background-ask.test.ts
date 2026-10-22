import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { registerAskTool } from "../src/ask-tool.ts";
import { createBackgroundAskRuntime } from "../src/background-ask.ts";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import type { AskParams, AskResult } from "../src/types.ts";
import { runAskFlow } from "../src/ui/controller.ts";
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
	let aborts = 0;
	let signal: AbortSignal | undefined;
	let focused: unknown = { getText: () => "", setText: () => undefined };
	const widgets = new Map<string, { render: (width: number) => string[] }>();
	const tui = {
		requestRender: () => undefined,
		get children() {
			return [focused];
		},
	};
	const pi = {
		registerCommand: () => undefined,
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		appendEntry(customType: string, data: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		sendMessage(message: any, options: any) {
			messages.push({ ...message, triggerTurn: options.triggerTurn });
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
		abort: () => {
			aborts += 1;
		},
		cwd: process.cwd(),
		mode: "tui",
		isIdle: () => idle,
		get signal() {
			return signal;
		},
		sessionManager: { getBranch: () => branch },
		ui: {
			onTerminalInput: () => () => undefined,
			custom(factory: any) {
				return new Promise<AskResult>((resolve) => {
					let component: any;
					const done = (result: AskResult) => {
						component?.dispose?.();
						focused = { getText: () => "", setText: () => undefined };
						resolve(result);
					};
					component = factory(
						tui,
						{
							fg: (_color: string, text: string) => text,
							bg: (_color: string, text: string) => text,
							bold: (text: string) => text,
						},
						{},
						done
					);
					forms.push(done);
					focused = component;
				});
			},
			setWidget(key: string, factory: any) {
				if (!factory) {
					widgets.delete(key);
					return;
				}
				const widget = factory(tui);
				widgets.set(key, widget);
				queueMicrotask(() => widget.render(80));
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
		get aborts() {
			return aborts;
		},
		cancelForm() {
			(focused as { handleInput: (data: string) => void }).handleInput(
				"\u001b"
			);
		},
		setEditorReady(ready: boolean) {
			focused = ready ? { getText: () => "", setText: () => undefined } : {};
			for (const widget of widgets.values()) {
				widget.render(80);
			}
		},
		setSignal(value: AbortSignal | undefined) {
			signal = value;
		},
		setIdle(value: boolean) {
			idle = value;
		},
	};
}

test("a branch restore during config loading cannot mount the abandoned background form", async () => {
	const h = harness();
	const store = getAskConfigStore();
	const ensureLoaded = store.ensureLoaded.bind(store);
	let release: (() => void) | undefined;
	const loading = new Promise<void>((resolve) => {
		release = resolve;
	});
	store.ensureLoaded = async () => {
		await loading;
		return ensureLoaded();
	};
	try {
		h.runtime.enqueue("loading", params, h.ctx as never, false);
		await tick();
		h.runtime.restore(h.ctx as never);
		release?.();
		await tick();
		assert.equal(h.forms.length, 1);
		h.forms[0](answer);
		await tick();
		h.boundary();
		assert.equal(h.messages.length, 1);
	} finally {
		release?.();
		store.ensureLoaded = ensureLoaded;
		h.runtime.dispose();
	}
});
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

test("the queue stays blocked from enqueue until its last form closes", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	const active = () => h.events.map((event) => event.data.active);
	h.runtime.enqueue("first", params, h.ctx as never, false);
	h.runtime.enqueue("second", params, h.ctx as never, false);
	assert.deepEqual(active(), [true]);
	await tick();
	h.forms[0](answer);
	await tick();
	assert.deepEqual(active(), [true]);
	assert.equal(h.runtime.pendingCount(), 1);
	h.forms[1](answer);
	await tick();
	assert.deepEqual(active(), [true, false]);
});

test("recovery stays blocked while its editor is unavailable and clears on branch change", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.enqueue("pending", params, h.ctx as never, false);
	h.setEditorReady(false);
	h.runtime.restore(h.ctx as never);
	await tick();
	assert.equal(h.forms.length, 0);
	assert.deepEqual(
		h.events.map((event) => event.data.active),
		[true]
	);
	h.branch.length = 0;
	h.runtime.restore(h.ctx as never);
	assert.deepEqual(
		h.events.map((event) => event.data.active),
		[true, false]
	);
});

test("a foreground surface cannot clear a still-pending background queue", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	const foreground = runAskFlow(h.ctx as never, params, {
		herdrEvents: h.pi.events as never,
	});
	await tick();
	h.runtime.enqueue("background", params, h.ctx as never, false);
	h.forms[0](answer);
	await foreground;
	await tick();
	assert.equal(h.forms.length, 2);
	assert.deepEqual(
		h.events.map((event) => event.data.active),
		[true]
	);
	h.forms[1](answer);
	await tick();
	assert.deepEqual(
		h.events.map((event) => event.data.active),
		[true, false]
	);
});

test("cancelling a background form records cancellation without aborting agent work", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.enqueue("cancel", params, h.ctx as never, false);
	await tick();
	h.cancelForm();
	await tick();
	assert.equal(h.aborts, 0);
	assert.equal(h.runtime.pendingCount(), 0);
	const completion = h.branch.find(
		(entry) => entry.customType === "ask:queue-completed"
	);
	assert.equal(completion.data.result.cancelled, true);
});

test("an interrupted background form keeps cancellation independent when reopened directly", async () => {
	const h = harness();
	const result = runAskFlow(h.ctx as never, { ...params, background: true });
	await tick();
	h.cancelForm();
	assert.equal((await result).cancelled, true);
	assert.equal(h.aborts, 0);
});

test("cancelling a foreground form still aborts the current operation", async () => {
	const h = harness();
	const result = runAskFlow(h.ctx as never, params);
	await tick();
	h.cancelForm();
	assert.equal((await result).cancelled, true);
	assert.equal(h.aborts, 1);
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

test("disabling explicit waiting preserves pending questions and asynchronous delivery", async () => {
	const h = harness();
	h.runtime.enqueue("mode-change", params, h.ctx as never, false);
	await tick();
	const waiting = h.runtime.wait(undefined);
	const stopped = assert.rejects(waiting, { message: "Waiting disabled" });
	h.runtime.interruptWait(new Error("Waiting disabled"));
	await stopped;
	assert.equal(h.aborts, 0);
	h.forms[0](answer);
	await tick();
	h.boundary();
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0].details.requestId, "mode-change");
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

test("recovery waits for the editor instead of opening behind the reload screen", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.enqueue("pending-reload", params, h.ctx as never, false);
	await tick();
	h.runtime.restore(h.ctx as never);
	h.setEditorReady(false);
	await tick();
	assert.equal(h.forms.length, 1);
	assert.equal(h.runtime.pendingCount(), 1);
	const waiting = h.runtime.wait(undefined);
	h.setEditorReady(true);
	await tick();
	assert.equal(h.forms.length, 2);
	h.forms[1](answer);
	assert.equal((await waiting).results[0].requestId, "pending-reload");
	h.runtime.dispose();
});

test("new requests cannot bypass recovery while the editor is loading", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.enqueue("first", params, h.ctx as never, false);
	await tick();
	h.runtime.restore(h.ctx as never);
	h.setEditorReady(false);
	h.runtime.enqueue("second", params, h.ctx as never, false);
	await tick();
	assert.equal(h.forms.length, 1);
	h.setEditorReady(true);
	await tick();
	assert.equal(h.forms.length, 2);
	h.forms[1](answer);
	await tick();
	assert.equal(h.forms.length, 3);
	h.forms[2](answer);
});

test("leaving a recovering branch removes its editor wait", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.enqueue("old", params, h.ctx as never, false);
	await tick();
	h.runtime.restore(h.ctx as never);
	h.setEditorReady(false);
	h.branch.length = 0;
	h.runtime.restore(h.ctx as never);
	h.setEditorReady(true);
	await tick();
	assert.equal(h.forms.length, 1);
	assert.equal(h.runtime.pendingCount(), 0);
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

test("idle delivery stays claimed when turn_start runs before the answer is persisted", async () => {
	const h = harness();
	h.pi.sendMessage = (message, options) => {
		h.messages.push({ ...message, triggerTurn: options.triggerTurn });
	};
	h.setIdle(true);
	h.runtime.enqueue("idle-race", params, h.ctx as never, false);
	await tick();
	h.forms[0](answer);
	await tick();
	assert.equal(h.messages.length, 1);
	h.setIdle(false);
	h.handlers.get("turn_start")?.({}, h.ctx);
	h.branch.push({ type: "custom_message", ...h.messages[0] });
	assert.equal(h.boundary(), undefined);
	assert.equal(h.messages.length, 1);
	h.runtime.reconcileDelivery(h.ctx as never);
	assert.equal(h.boundary(), undefined);
	h.runtime.dispose();
});

test("background cancellation adds context without waking the idle agent, including after recovery", async () => {
	const h = harness();
	h.setIdle(true);
	h.runtime.enqueue("cancelled", params, h.ctx as never, false);
	await tick();
	h.forms[0]({ ...answer, cancelled: true, answers: {} });
	await tick();
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0].triggerTurn, false);
	h.runtime.restore(h.ctx as never);
	await tick();
	assert.equal(h.messages.length, 1);
	h.runtime.dispose();
});

test("a cancellation-only boundary never requests another turn", async () => {
	const h = harness();
	h.runtime.enqueue("cancelled", params, h.ctx as never, false);
	await tick();
	h.forms[0]({ ...answer, cancelled: true, answers: {} });
	await tick();
	assert.equal(h.boundary().continue, false);
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

test("aborting the wait clears blocked status without closing the question panel", async () => {
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
	h.forms[0](answer);
	await tick();
	assert.deepEqual(
		h.events.map((event) => event.data.active),
		[true, false]
	);
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

test("delayed cards retain direct and nested visible owners independently of Wait consumption", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	const start = h.handlers.get("tool_execution_start");
	assert(start);
	start({ toolCallId: "direct", toolName: "ask_user" });
	start({ toolCallId: "outer", toolName: "codemode" });
	start({
		toolCallId: "middle",
		parentToolCallId: "outer",
		toolName: "wrapper",
	});
	start({
		toolCallId: "leaf",
		parentToolCallId: "middle",
		toolName: "ask_user",
	});
	h.runtime.enqueue("one", params, h.ctx as never, false, "direct");
	h.runtime.enqueue("two", params, h.ctx as never, false, "leaf");
	await tick();
	const waiting = h.runtime.wait(undefined);
	h.forms[0](answer);
	await tick();
	h.forms[1](answer);
	const result = await waiting;
	assert.deepEqual(
		result.results.map((item) => item.parentToolCallId),
		["direct", "outer"]
	);
	const cards = h.branch.filter(
		(entry) => entry.customType === "ask:queue-completed"
	);
	assert.deepEqual(
		cards.map((entry) => entry.data.parentToolCallId),
		["direct", "outer"]
	);
	assert(cards.every((entry) => entry.data.display === true));
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
	assert.deepEqual((await h.runtime.wait(undefined)).results, []);
	assert.equal(h.messages.length, 0);
	assert.equal(
		h.branch.filter((entry) => entry.customType === "ask:queue-completed")
			.length,
		2
	);
});

test("automatic model delivery is hidden while the durable answer card stays at its owner", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.handlers.get("tool_execution_start")?.({
		toolCallId: "origin",
		toolName: "ask_user",
	});
	h.runtime.enqueue("one", params, h.ctx as never, false, "origin");
	await tick();
	h.forms[0](answer);
	await tick();
	h.boundary();
	assert.equal(h.messages[0].display, false);
	assert.deepEqual(h.messages[0].details.result, answer);
	assert.equal(
		h.branch.find((entry) => entry.customType === "ask:queue-completed").data
			.parentToolCallId,
		"origin"
	);
});

test("Wait renders a brief confirmation without removing complete agent data", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	registerWaitForAnswersTool(h.pi as never, h.runtime);
	h.runtime.enqueue("one", params, h.ctx as never, false);
	await tick();
	const tool = h.tools.get("wait_for_answers");
	const waiting = tool.execute("wait", {}, undefined, undefined, h.ctx);
	h.forms[0](answer);
	const result = await waiting;
	assert(result.content[0].text.includes("Choose?"));
	const visible = tool
		.renderResult(result, {}, { fg: (_: string, text: string) => text })
		.render(100)
		.join("\n");
	assert(visible.includes("1 background answer"));
	assert(!visible.includes("Choose?"));
});

test("pending recovery keeps captured ownership without retaining live execution maps", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.trackExecution({ toolCallId: "root" });
	h.runtime.trackExecution({ toolCallId: "nested", parentToolCallId: "root" });
	h.runtime.enqueue("saved", params, h.ctx as never, false, "nested");
	await tick();
	h.runtime.forgetExecution("nested");
	h.runtime.forgetExecution("root");
	h.runtime.restore(h.ctx as never);
	await tick();
	h.forms[0]({ ...answer, cancelled: true });
	h.forms[1](answer);
	await tick();
	h.boundary();
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0].details.parentToolCallId, "root");
	assert.equal(
		h.branch.filter((entry) => entry.customType === "ask:queue-completed")
			.length,
		1
	);
});

test("unknown ancestry stays unowned instead of guessing a root from an ID", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.trackExecution({
		toolCallId: "guessed-root/1",
		parentToolCallId: "unobserved",
	});
	h.runtime.enqueue("unowned", params, h.ctx as never, false, "guessed-root/1");
	await tick();
	h.forms[0](answer);
	await tick();
	h.boundary();
	assert.equal(h.messages[0].details.parentToolCallId, undefined);
});

test("a rejected delivery boundary can retry without duplicating the visible card", async (t) => {
	const h = harness();
	t.after(() => h.runtime.dispose());
	h.runtime.trackExecution({ toolCallId: "root" });
	h.runtime.enqueue("retry", params, h.ctx as never, false, "root");
	await tick();
	h.forms[0](answer);
	await tick();
	const draft = h.handlers.get("turn_end")?.({ entries: [] }, h.ctx);
	assert(draft);
	assert.equal(draft.entries.length, 1);
	// No finalized message: the boundary proposal was not committed.
	h.runtime.reconcileDelivery(h.ctx as never);
	h.boundary();
	assert.equal(h.messages.length, 1);
	assert.equal(
		h.branch.filter((entry) => entry.customType === "ask:queue-completed")
			.length,
		1
	);
});

test("automatic and waited image answers keep complete data on exactly one model path", async (t) => {
	for (const waited of [false, true]) {
		const h = harness();
		t.after(() => h.runtime.dispose());
		registerWaitForAnswersTool(h.pi as never, h.runtime);
		h.runtime.trackExecution({ toolCallId: "root" });
		h.runtime.enqueue("image", params, h.ctx as never, false, "root");
		await tick();
		const waiting = waited
			? h.tools
					.get("wait_for_answers")
					.execute("wait", {}, undefined, undefined, h.ctx)
			: undefined;
		const image = {
			id: "example",
			mimeType: "image/png",
			data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=",
		};
		h.forms[0]({
			...answer,
			answers: { choice: { ...answer.answers.choice, customImages: [image] } },
		});
		await tick();
		const result = waiting ? await waiting : undefined;
		if (result) {
			assert.equal(
				result.content.filter((part: { type: string }) => part.type === "image")
					.length,
				1
			);
			assert.deepEqual(
				result.structuredContent.results[0].result.answers.choice.customImages,
				[image]
			);
			h.branch.push({
				type: "message",
				message: {
					role: "toolResult",
					toolName: "wait_for_answers",
					isError: false,
					details: result.details,
				},
			});
		} else {
			h.boundary();
			assert.equal(h.messages.length, 1);
			assert.equal(h.messages[0].display, false);
			assert.equal(
				h.messages[0].content.filter(
					(part: { type: string }) => part.type === "image"
				).length,
				1
			);
		}
		h.runtime.reconcileDelivery(h.ctx as never);
		assert.deepEqual((await h.runtime.wait(undefined)).results, []);
	}
});
