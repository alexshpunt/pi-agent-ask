import assert from "node:assert/strict";
import test from "node:test";
import { beginUserWait } from "../src/herdr-wait-state.ts";
import {
	bindQuestionTerminal,
	registerQuestionStatus,
} from "../src/program-status.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(mode = "tui") {
	const reports: Record<string, unknown>[] = [];
	const legacy: unknown[] = [];
	const handlers = new Map<string, (...args: any[]) => void>();
	let idle = false;
	const context = { mode, isIdle: () => idle };
	const terminal = {
		setProgramStatus(status: Record<string, unknown>) {
			assert.equal(this, terminal);
			reports.push(status);
		},
	};
	const events = {
		emit(_name: string, payload: unknown) {
			legacy.push(payload);
		},
	};
	registerQuestionStatus({
		events,
		on(name: string, handler: (...args: any[]) => void) {
			handlers.set(name, handler);
		},
	} as never);
	return {
		bind: () => bindQuestionTerminal(events, terminal, context as never),
		context,
		events,
		fire(name: string, event = {}) {
			handlers.get(name)?.(event, context);
		},
		idle(value: boolean) {
			idle = value;
		},
		legacy,
		reports,
		terminal,
	};
}

test("custom mount and lifecycle reports reassert a visible question", async () => {
	const h = harness();
	const end = beginUserWait(h.events, "Waiting for user response");
	h.bind();
	// Model the host's custom-dialog mount, which currently clears its dialog status.
	h.terminal.setProgramStatus({ state: "working" });
	await tick();
	assert.deepEqual(h.reports.at(-1), {
		app: "pi",
		state: "blocked",
		kind: "question",
		message: "Waiting for user response",
	});
	h.fire("agent_start");
	h.terminal.setProgramStatus({ state: "working" });
	await tick();
	assert.equal(h.reports.at(-1)?.state, "blocked");
	h.idle(true);
	h.fire("agent_settled");
	h.terminal.setProgramStatus({ state: "done" });
	await tick();
	assert.equal(h.reports.at(-1)?.state, "blocked");
	end();
	assert.equal(h.reports.at(-1)?.state, "done");
});

test("compaction and dialog lifecycle cannot leave an active question unreported", async () => {
	const h = harness();
	h.idle(true);
	h.bind();
	const end = beginUserWait(h.events, "Waiting");
	for (const event of [
		"session_before_compact",
		"session_compact",
		"session_compact_failed",
		"ui_prompt_end",
	]) {
		h.fire(event);
		h.terminal.setProgramStatus({ state: "working" });
		await tick();
		assert.equal(h.reports.at(-1)?.state, "blocked", event);
	}
	end();
});

test("overlapping forms and explicit waits share one balanced transport owner", async () => {
	const h = harness();
	h.bind();
	const endPanel = beginUserWait(h.events, "Waiting for user response");
	const endWait = beginUserWait(h.events, "Waiting for user answers");
	endPanel();
	await tick();
	assert.equal(h.reports.at(-1)?.state, "blocked");
	assert.equal(h.legacy.length, 1);
	endWait();
	assert.equal(h.reports.at(-1)?.state, "working");
	assert.deepEqual(h.legacy.at(-1), { active: false });
	const count = h.reports.length;
	endWait();
	endPanel();
	await tick();
	assert.equal(h.reports.length, count);
});

test("hide, reopen and final release cancel stale blocked callbacks", async () => {
	const h = harness();
	h.bind();
	const hide = beginUserWait(h.events, "Waiting");
	hide();
	await tick();
	assert.equal(h.reports.at(-1)?.state, "working");
	const answer = beginUserWait(h.events, "Waiting");
	await tick();
	assert.equal(h.reports.at(-1)?.state, "blocked");
	h.fire("agent_start");
	answer();
	await tick();
	assert.equal(h.reports.at(-1)?.state, "working");
});

test("idle, failed and aborted runs restore distinct resting states", async () => {
	for (const [outcome, aborted, expected] of [
		["stop", false, "done"],
		["error", false, "error"],
		["error", true, "idle"],
	] as const) {
		const h = harness();
		h.idle(true);
		h.bind();
		const end = beginUserWait(h.events, "Waiting");
		h.fire("agent_start");
		h.fire("message_end", {
			message: { role: "assistant", stopReason: outcome },
		});
		h.fire("agent_settled", { aborted });
		await tick();
		assert.equal(h.reports.at(-1)?.state, "blocked");
		end();
		assert.equal(h.reports.at(-1)?.state, expected);
	}
});

test("shutdown cancels pending writes and cannot clear a later session", async () => {
	const h = harness();
	h.bind();
	const end = beginUserWait(h.events, "Waiting");
	h.fire("session_shutdown");
	const count = h.reports.length;
	end();
	await tick();
	assert.equal(h.reports.length, count);
	assert.equal(h.reports.at(-1)?.state, "working");
	h.fire("session_start");
	h.idle(true);
	h.bind();
	const endNew = beginUserWait(h.events, "New session");
	await tick();
	assert.equal(h.reports.at(-1)?.message, "New session");
	endNew();
	assert.equal(h.reports.at(-1)?.state, "idle");
});

test("non-TUI, older terminals and transport failures preserve legacy waits", async () => {
	const rpc = harness("rpc");
	rpc.bind();
	const endRpc = beginUserWait(rpc.events, "Waiting");
	await tick();
	endRpc();
	assert.equal(rpc.reports.length, 0);
	assert.equal(rpc.legacy.length, 2);
	const h = harness();
	for (const terminal of [
		undefined,
		{},
		{ setProgramStatus: false },
		{
			setProgramStatus() {
				throw new Error("transport failed");
			},
		},
	]) {
		bindQuestionTerminal(h.events, terminal, h.context as never);
		const end = beginUserWait(h.events, "Waiting");
		await tick();
		assert.doesNotThrow(end);
	}
	assert.equal(h.legacy.length, 8);
});
