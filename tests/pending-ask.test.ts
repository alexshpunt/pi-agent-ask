import assert from "node:assert/strict";
import test from "node:test";
import { appendAskHistoryRequest } from "../src/ask-history.ts";
import { reserveRecoverySurfaces } from "../src/ask-recovery-order.ts";
import { reserveAskSurface } from "../src/ask-surface.ts";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import {
	ASK_PENDING_DISMISSED_ENTRY_TYPE,
	findPendingAskToolCall,
} from "../src/pending-ask.ts";
import {
	createRemoteAskRuntime,
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskCompletedEvent,
	type RemoteAskStartedEvent,
} from "../src/remote-ask.ts";
import { registerPendingAskResume } from "../src/resume-pending-ask.ts";
import { createInitialState } from "../src/state/create.ts";
import type { AskParams } from "../src/types.ts";

const CANVAS_RE = /Canvas/;

const params: AskParams = {
	title: "Choose engine",
	questions: [
		{
			id: "engine",
			prompt: "Chart engine?",
			options: [
				{ value: "canvas", label: "Canvas" },
				{ value: "svg", label: "SVG" },
			],
		},
	],
};

class TestEventBus {
	readonly events: Array<{ channel: string; data: unknown }> = [];
	private readonly handlers = new Map<string, Array<(data: unknown) => void>>();

	emit(channel: string, data: unknown): void {
		this.events.push({ channel, data });
		for (const handler of this.handlers.get(channel) ?? []) {
			handler(data);
		}
	}

	on(channel: string, handler: (data: unknown) => void): () => void {
		const handlers = this.handlers.get(channel) ?? [];
		handlers.push(handler);
		this.handlers.set(channel, handlers);
		return () => {
			this.handlers.set(
				channel,
				(this.handlers.get(channel) ?? []).filter(
					(candidate) => candidate !== handler
				)
			);
		};
	}
}

function askToolCall(id: string, argumentsValue: unknown = params) {
	return assistantMessage([
		{ type: "toolCall", id, name: "ask_user", arguments: argumentsValue },
	]);
}

function assistantMessage(content: unknown[], stopReason = "toolUse") {
	return {
		type: "message",
		message: { role: "assistant", content, stopReason },
	};
}

function toolResult(toolCallId: string) {
	return {
		type: "message",
		message: { role: "toolResult", toolCallId, toolName: "ask_user" },
	};
}

function storedPayload(
	sourceEntryId: string,
	storedParams: unknown = params,
	version = 1
) {
	return {
		type: "custom",
		customType: "ask:payload",
		data: {
			version,
			source: "tool",
			params: storedParams,
			sourceEntryId,
			timestamp: 1,
		},
	};
}

function dismissed(toolCallId: string) {
	return {
		type: "custom",
		customType: ASK_PENDING_DISMISSED_ENTRY_TYPE,
		data: { toolCallId },
	};
}

function scannerContext(branch: unknown[]) {
	return { sessionManager: { getBranch: () => branch } } as never;
}

test("pending ask scan selects the newest unresolved ask_user call", () => {
	const pending = findPendingAskToolCall(
		scannerContext([
			askToolCall("call-1"),
			storedPayload("call-1"),
			askToolCall("call-2"),
			storedPayload("call-2"),
			toolResult("call-2"),
		])
	);

	assert.deepEqual(pending, { params, toolCallId: "call-1" });
});

test("pending ask scan uses the latest unresolved call within one assistant message", () => {
	const pending = findPendingAskToolCall(
		scannerContext([
			assistantMessage([
				{ type: "toolCall", id: "call-1", name: "ask_user", arguments: params },
				{ type: "toolCall", id: "other", name: "read", arguments: {} },
				{ type: "toolCall", id: "call-2", name: "ask_user", arguments: params },
			]),
		])
	);

	assert.equal(pending?.toolCallId, "call-2");
});

test("pending ask scan ignores tool-shaped content from failed assistant responses", () => {
	assert.equal(
		findPendingAskToolCall(
			scannerContext([
				assistantMessage(
					[
						{
							type: "toolCall",
							id: "failed-call",
							name: "ask_user",
							arguments: params,
						},
					],
					"error"
				),
			])
		),
		undefined
	);
});

test("pending ask scan prefers its valid persisted payload", () => {
	const persistedParams = { ...params, title: "Persisted title" };
	const pending = findPendingAskToolCall(
		scannerContext([
			askToolCall("call-1", { ...params, title: "Recorded title" }),
			storedPayload("call-1", persistedParams),
		])
	);

	assert.deepEqual(pending?.params, persistedParams);
});

test("pending ask scan validates recorded arguments as payload fallback", () => {
	assert.deepEqual(
		findPendingAskToolCall(scannerContext([askToolCall("call-1")])),
		{ params, toolCallId: "call-1" }
	);
	assert.deepEqual(
		findPendingAskToolCall(
			scannerContext([
				askToolCall("call-2"),
				storedPayload("call-2", params, 99),
			])
		),
		{ params, toolCallId: "call-2" }
	);
	assert.deepEqual(
		findPendingAskToolCall(
			scannerContext([askToolCall("call-3"), storedPayload("call-3", {})])
		),
		{ params, toolCallId: "call-3" }
	);
	assert.equal(
		findPendingAskToolCall(
			scannerContext([askToolCall("call-4", { questions: [] })])
		),
		undefined
	);
	assert.equal(
		findPendingAskToolCall(scannerContext([askToolCall("call-5", {})])),
		undefined
	);
});

test("pending ask scan skips a newer invalid call for an older valid call", () => {
	const pending = findPendingAskToolCall(
		scannerContext([
			askToolCall("valid-call"),
			askToolCall("invalid-call", { questions: [] }),
		])
	);

	assert.deepEqual(pending, { params, toolCallId: "valid-call" });
});

test("pending ask scan ignores tool results and persisted dismissals", () => {
	assert.equal(
		findPendingAskToolCall(
			scannerContext([askToolCall("call-1"), toolResult("call-1")])
		),
		undefined
	);
	assert.equal(
		findPendingAskToolCall(
			scannerContext([askToolCall("call-2"), dismissed("call-2")])
		),
		undefined
	);
});

test("pending ask resume scans only startup, resume, and fork TUI events", () => {
	let sessionStartHandler: ((event: any, ctx: any) => void) | undefined;
	const remoteAsk = createRemoteAskRuntime(new TestEventBus() as never);
	registerPendingAskResume(
		{
			on(event: string, handler: (event: any, ctx: any) => void) {
				if (event === "session_start") {
					sessionStartHandler = handler;
				}
			},
		} as never,
		remoteAsk
	);
	assert(sessionStartHandler);

	const branchReads: string[] = [];
	for (const reason of ["startup", "resume", "fork", "new", "reload"]) {
		sessionStartHandler(
			{ type: "session_start", reason },
			{
				mode: "tui",
				sessionManager: {
					getBranch() {
						branchReads.push(reason);
						return [];
					},
				},
			}
		);
	}

	sessionStartHandler(
		{ type: "session_start", reason: "startup" },
		{
			mode: "rpc",
			sessionManager: {
				getBranch() {
					branchReads.push("rpc");
					return [];
				},
			},
		}
	);

	assert.deepEqual(branchReads, ["startup", "resume", "fork"]);
	remoteAsk.disposeAll();
});

test("resumed submit persists dismissal, delivers an answer, and emits remote lifecycle events", {
	timeout: 2000,
}, async () => {
	getAskConfigStore().setConfig(disabledNotificationConfig());
	const branch: unknown[] = [askToolCall("call-1"), storedPayload("call-1")];
	const bus = new TestEventBus();
	const remoteAsk = createRemoteAskRuntime(bus as never);
	const delivered: Array<{ text: string; options: unknown }> = [];
	let resolveDelivery: (() => void) | undefined;
	const delivery = new Promise<void>((resolve) => {
		resolveDelivery = resolve;
	});
	const harness = createResumeHarness(branch, remoteAsk, {
		idle: false,
		onSend(text, options) {
			delivered.push({ text, options });
			resolveDelivery?.();
		},
	});

	bus.on(PI_ASK_STARTED_EVENT, (data) => {
		const started = data as RemoteAskStartedEvent;
		bus.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			requestId: "submit-1",
			flowId: started.flowId,
			response: {
				kind: "answer",
				answers: { engine: { values: ["canvas"] } },
			},
		});
	});

	const handlerResult = harness.start("resume");
	assert.equal(handlerResult, undefined);
	await delivery;

	assert.deepEqual(harness.dismissedToolCallIds, ["call-1"]);
	assert.equal(delivered.length, 1);
	assert.match(delivered[0].text, CANVAS_RE);
	assert.deepEqual(delivered[0].options, { deliverAs: "followUp" });

	const started = findEvent<RemoteAskStartedEvent>(bus, PI_ASK_STARTED_EVENT);
	assert.equal(started.source, "ask:resume");
	assert.equal(started.toolCallId, "call-1");
	const completed = findEvent<RemoteAskCompletedEvent>(
		bus,
		PI_ASK_COMPLETED_EVENT
	);
	assert.equal(completed.source, "ask:resume");
	assert.equal(completed.result.cancelled, false);

	remoteAsk.disposeAll();
	getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
});

test("resumed cancel persists dismissal and does not reopen on a second resume", {
	timeout: 2000,
}, async () => {
	getAskConfigStore().setConfig(disabledNotificationConfig());
	const branch: unknown[] = [askToolCall("call-1"), storedPayload("call-1")];
	const bus = new TestEventBus();
	const remoteAsk = createRemoteAskRuntime(bus as never);
	let resolveCancellation: (() => void) | undefined;
	const cancellation = new Promise<void>((resolve) => {
		resolveCancellation = resolve;
	});
	const harness = createResumeHarness(branch, remoteAsk, {
		onDismissNotice: () => resolveCancellation?.(),
	});

	bus.on(PI_ASK_STARTED_EVENT, (data) => {
		const started = data as RemoteAskStartedEvent;
		bus.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			requestId: "cancel-1",
			flowId: started.flowId,
			response: { kind: "cancel" },
		});
	});

	harness.start("startup");
	await cancellation;
	await new Promise<void>((resolve) => setImmediate(resolve));
	harness.start("resume");
	await new Promise<void>((resolve) => setImmediate(resolve));

	assert.deepEqual(harness.dismissedToolCallIds, ["call-1"]);
	assert.equal(harness.sentMessages.length, 0);
	assert.equal(
		bus.events.filter((event) => event.channel === PI_ASK_STARTED_EVENT).length,
		1
	);
	const completed = findEvent<RemoteAskCompletedEvent>(
		bus,
		PI_ASK_COMPLETED_EVENT
	);
	assert.equal(completed.source, "ask:resume");
	assert.equal(completed.result.cancelled, true);

	remoteAsk.disposeAll();
	getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
});

function createResumeHarness(
	branch: unknown[],
	remoteAsk: ReturnType<typeof createRemoteAskRuntime>,
	options: {
		idle?: boolean;
		onDismissNotice?: () => void;
		onSend?: (text: string, sendOptions: unknown) => void;
	} = {}
) {
	let sessionStartHandler: ((event: any, ctx: any) => void) | undefined;
	const handlers = new Map<string, (event: any, ctx: any) => void>();
	const dismissedToolCallIds: string[] = [];
	const sentMessages: Array<{ text: string; options: unknown }> = [];

	registerPendingAskResume(
		{
			on(event: string, handler: (event: any, ctx: any) => void) {
				handlers.set(event, handler);
				if (event === "session_start") {
					sessionStartHandler = handler;
				}
			},
			appendEntry(customType: string, data: { toolCallId: string }) {
				branch.push({ type: "custom", customType, data });
				if (customType === ASK_PENDING_DISMISSED_ENTRY_TYPE) {
					dismissedToolCallIds.push(data.toolCallId);
					options.onDismissNotice?.();
				}
			},
			sendUserMessage(text: string, sendOptions: unknown) {
				sentMessages.push({ text, options: sendOptions });
				options.onSend?.(text, sendOptions);
			},
		} as never,
		remoteAsk
	);
	assert(sessionStartHandler);

	const ctx = {
		cwd: process.cwd(),
		isIdle: () => options.idle ?? true,
		abort: () => undefined,
		mode: "tui",
		sessionManager: { getBranch: () => branch },
		ui: {
			custom(callback: (...args: any[]) => unknown) {
				return new Promise((resolve) => {
					let component: { dispose?(): void } | undefined;
					const done = (value: unknown) => {
						queueMicrotask(() => component?.dispose?.());
						resolve(value);
					};
					component = callback(
						{
							requestRender() {
								// Rendering is not needed for this lifecycle test.
							},
						},
						plainTheme(),
						{},
						done
					) as { dispose?(): void };
				});
			},
			notify() {
				// Notifications are not the lifecycle assertion surface.
			},
			setWorkingVisible() {
				// The harness only checks completion behavior.
			},
		},
	};

	return {
		dismissedToolCallIds,
		sentMessages,
		start(reason: "startup" | "resume" | "fork") {
			sessionStartHandler?.({ type: "session_start", reason }, ctx);
			return handlers.get("resources_discover")?.(
				{ type: "resources_discover" },
				ctx
			);
		},
		navigate() {
			handlers.get("session_tree")?.({ type: "session_tree" }, ctx);
		},
		dispose() {
			handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
		},
	};
}

function queueEntry(requestId: string) {
	return {
		type: "custom",
		customType: "ask:queued",
		data: {
			version: 1,
			requestId,
			toolCallId: "background-call",
			params,
			presentSingleAsMulti: false,
		},
	};
}

for (const backgroundFirst of [true, false]) {
	test(`mixed recovery preserves accepted arrival order: backgroundFirst=${backgroundFirst}`, async () => {
		const branch: unknown[] = [askToolCall("foreground-call")];
		const writer = {
			appendEntry: (customType: string, data: unknown) => {
				branch.push({ type: "custom", customType, data });
			},
		};
		let backgroundId: string;
		if (backgroundFirst) {
			backgroundId = appendAskHistoryRequest(
				writer,
				"background-call",
				createInitialState(params),
				true
			);
			appendAskHistoryRequest(
				writer,
				"foreground-call",
				createInitialState(params),
				false
			);
		} else {
			appendAskHistoryRequest(
				writer,
				"foreground-call",
				createInitialState(params),
				false
			);
			backgroundId = appendAskHistoryRequest(
				writer,
				"background-call",
				createInitialState(params),
				true
			);
		}
		branch.push(queueEntry(backgroundId));
		const surfaces = reserveRecoverySurfaces(branch as never, {
			toolCallId: "foreground-call",
			params,
		});
		const background = surfaces.background.get(backgroundId);
		assert(background);
		assert(surfaces.foreground);
		const opened: string[] = [];
		const foreground = surfaces.foreground.run(undefined, () => {
			opened.push("foreground");
			return Promise.resolve();
		});
		await background.run(undefined, () => {
			opened.push("background");
			return Promise.resolve();
		});
		await foreground;
		assert.deepEqual(
			opened,
			backgroundFirst
				? ["background", "foreground"]
				: ["foreground", "background"]
		);
	});
}

test("legacy recovery falls back to queued and assistant entry positions", async () => {
	const branch = [
		queueEntry("background-request"),
		askToolCall("foreground-call"),
	];
	const surfaces = reserveRecoverySurfaces(branch as never, {
		toolCallId: "foreground-call",
		params,
	});
	const background = surfaces.background.get("background-request");
	assert(background);
	assert(surfaces.foreground);
	const opened: string[] = [];
	const foreground = surfaces.foreground.run(undefined, () => {
		opened.push("foreground");
		return Promise.resolve();
	});
	await background.run(undefined, () => {
		opened.push("background");
		return Promise.resolve();
	});
	await foreground;
	assert.deepEqual(opened, ["background", "foreground"]);
});

test("hidden background recovery does not reserve a foreground-blocking slot", async () => {
	const branch = [
		queueEntry("hidden-request"),
		{ type: "custom", customType: "ask:queue-ui", data: { hidden: true } },
		askToolCall("foreground-call"),
	];
	const surfaces = reserveRecoverySurfaces(branch as never, {
		toolCallId: "foreground-call",
		params,
	});
	assert.equal(surfaces.background.size, 0);
	assert(surfaces.foreground);
	await surfaces.foreground.run(undefined, () => Promise.resolve());
});

test("leaving a branch aborts a queued recovered form before it can open or dismiss", async () => {
	const held = reserveAskSurface();
	await held.acquire();
	const branch: unknown[] = [askToolCall("old-call")];
	const bus = new TestEventBus();
	const remote = createRemoteAskRuntime(bus as never);
	const harness = createResumeHarness(branch, remote);
	try {
		harness.start("resume");
		await new Promise<void>((resolve) => setImmediate(resolve));
		branch.length = 0;
		harness.navigate();
		held.cancel();
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.deepEqual(harness.dismissedToolCallIds, []);
		assert.deepEqual(harness.sentMessages, []);
		assert.equal(
			bus.events.filter((event) => event.channel === PI_ASK_STARTED_EVENT)
				.length,
			0
		);
	} finally {
		held.cancel();
		harness.dispose();
		remote.disposeAll();
	}
});

test("leaving a branch closes an active recovered form without saving an outcome to the new branch", async () => {
	getAskConfigStore().setConfig(disabledNotificationConfig());
	const branch: unknown[] = [askToolCall("active-old-call")];
	const bus = new TestEventBus();
	const remote = createRemoteAskRuntime(bus as never);
	const opened = new Promise<void>((resolve) =>
		bus.on(PI_ASK_STARTED_EVENT, () => resolve())
	);
	const harness = createResumeHarness(branch, remote);
	try {
		harness.start("resume");
		await opened;
		branch.length = 0;
		harness.navigate();
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.deepEqual(branch, []);
		assert.deepEqual(harness.dismissedToolCallIds, []);
		assert.deepEqual(harness.sentMessages, []);
	} finally {
		harness.dispose();
		remote.disposeAll();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	}
});

function disabledNotificationConfig() {
	return {
		...DEFAULT_ASK_CONFIG,
		notifications: { ...DEFAULT_ASK_CONFIG.notifications, enabled: false },
	};
}

function findEvent<T>(bus: TestEventBus, channel: string): T {
	const event = bus.events.find((candidate) => candidate.channel === channel);
	assert(event);
	return event.data as T;
}

function plainTheme() {
	return {
		bg(_color: string, text: string) {
			return text;
		},
		fg(_color: string, text: string) {
			return text;
		},
	};
}
