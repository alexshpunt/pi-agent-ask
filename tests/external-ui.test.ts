import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	connectExternalAskUi,
	type ExternalAskConnection,
	type ExternalAskProvider,
	type ExternalAskRequest,
	PI_ASK_EXTERNAL_UI_EVENT,
	runExternalAskFlow,
} from "../src/external-ui.ts";
import { resolvePreviewFiles } from "../src/preview-files.ts";
import {
	createRemoteAskRuntime,
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	PI_ASK_SUBMIT_RESULT_EVENT,
} from "../src/remote-ask.ts";
import { createInitialState } from "../src/state/create.ts";

const INVALID_RESPONSE_RE = /invalid response/;
const DISCONNECTED_RE = /Disconnected/;

function eventBus() {
	const emitter = new EventEmitter();
	return {
		emit(channel: string, data: unknown) {
			emitter.emit(channel, data);
		},
		on(channel: string, handler: (data: unknown) => void) {
			emitter.on(channel, handler);
			return () => emitter.off(channel, handler);
		},
	};
}

const answer = { kind: "answer", answers: { color: { values: ["blue"] } } };
const provider: ExternalAskProvider = {
	id: "test",
	version: 1,
	open: () => Promise.resolve(answer),
};

function state() {
	return createInitialState({
		questions: [
			{
				id: "color",
				prompt: "Choose a color",
				options: [{ value: "blue", label: "Blue" }],
			},
		],
	});
}

test("external UI connection is explicit, versioned, first-wins, and call-scoped", () => {
	const bus = eventBus();
	let connection: ExternalAskConnection | undefined;
	bus.on(PI_ASK_EXTERNAL_UI_EVENT, (data) => {
		connection = data as ExternalAskConnection;
		assert.equal(connection.mode, "rpc");
		assert.equal(connection.toolCallId, "call");
		assert.equal(
			connection.connect({ ...provider, version: 2 } as never),
			false
		);
		assert.equal(connection.connect(provider), true);
		assert.equal(connection.connect({ ...provider, id: "second" }), false);
	});
	assert.equal(connectExternalAskUi(bus, "rpc", "call"), provider);
	assert(connection);
	assert.equal(connection.connect(provider), false);
});

test("a provider cannot claim an unconnected call after negotiation has returned", () => {
	const bus = eventBus();
	let connection: ExternalAskConnection | undefined;
	bus.on(PI_ASK_EXTERNAL_UI_EVENT, (data) => {
		connection = data as ExternalAskConnection;
	});
	assert.equal(connectExternalAskUi(bus, "rpc", "call"), undefined);
	assert(connection);
	assert.equal(connection.connect(provider), false);
});

test("TUI never negotiates an external surface and a missing connection stays unavailable", () => {
	const bus = eventBus();
	let emitted = false;
	bus.on(PI_ASK_EXTERNAL_UI_EVENT, () => {
		emitted = true;
	});
	assert.equal(connectExternalAskUi(bus, "tui", "call"), undefined);
	assert.equal(emitted, false);
	assert.equal(connectExternalAskUi(bus, "rpc", "call"), undefined);
});

test("single-as-multi uses the normalized presentation and original result metadata", async () => {
	const bus = eventBus();
	const runtime = createRemoteAskRuntime(bus as never);
	const initial = createInitialState(
		{
			questions: [
				{
					id: "color",
					prompt: "Choose?",
					options: [
						{ value: "blue", label: "Blue" },
						{ value: "red", label: "Red" },
					],
				},
			],
		},
		{ presentSingleAsMulti: true }
	);
	const result = await runExternalAskFlow({
		provider: {
			...provider,
			open(request) {
				assert.equal(request.questions[0].type, "multi");
				return Promise.resolve({
					kind: "answer",
					answers: { color: { values: ["blue", "red"] } },
				});
			},
		},
		runtime,
		state: initial,
		toolCallId: "multi",
	});
	assert.deepEqual(result.answers.color.values, ["blue", "red"]);
	assert.equal(result.questions[0].type, "single");
	assert.equal(result.questions[0].presentedType, "multi");
	runtime.disposeAll();
});
async function pendingFlow(signal?: AbortSignal) {
	const bus = eventBus();
	const runtime = createRemoteAskRuntime(bus as never);
	let deliver: ((response: unknown) => void) | undefined;
	let opened: ((request: ExternalAskRequest) => void) | undefined;
	const ready = new Promise<ExternalAskRequest>((resolve) => {
		opened = resolve;
	});
	const completed: unknown[] = [];
	bus.on(PI_ASK_COMPLETED_EVENT, (event) => {
		completed.push(event);
	});
	const pending = runExternalAskFlow({
		provider: {
			...provider,
			open(request) {
				opened?.(request);
				return new Promise((resolve) => {
					deliver = resolve;
				});
			},
		},
		runtime,
		state: state(),
		toolCallId: "call",
		signal,
	});
	const request = await ready;
	return {
		bus,
		runtime,
		request,
		pending,
		completed,
		deliver: (response: unknown) => deliver?.(response),
	};
}

test("connected form stays pending, computes answers locally, and cleans up exactly once", async () => {
	const flow = await pendingFlow();
	let settled = false;
	flow.pending.then(() => {
		settled = true;
	});
	await Promise.resolve();
	assert.equal(settled, false);
	flow.deliver(answer);
	const result = await flow.pending;
	assert.equal(result.cancelled, false);
	assert.deepEqual(result.answers.color.labels, ["Blue"]);
	assert.deepEqual(result.answers.color.indices, [1]);
	assert.equal(flow.request.signal.aborted, true);
	assert.equal(flow.completed.length, 1);
	let late: unknown;
	flow.bus.on(PI_ASK_SUBMIT_RESULT_EVENT, (data) => {
		late = data;
	});
	flow.bus.emit(PI_ASK_SUBMIT_EVENT, {
		version: 1,
		requestId: "late",
		flowId: flow.request.flowId,
		response: { kind: "cancel" },
	});
	assert.equal((late as { error: string }).error, "flow_not_found");
	assert.equal(flow.completed.length, 1);
	flow.runtime.disposeAll();
});

test("invalid local submission leaves the flow open; valid submission closes the provider", async () => {
	const flow = await pendingFlow();
	const results: unknown[] = [];
	flow.bus.on(PI_ASK_SUBMIT_RESULT_EVENT, (data) => {
		results.push(data);
	});
	for (const value of ["unknown", "blue"]) {
		flow.bus.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			requestId: value,
			flowId: flow.request.flowId,
			response: { kind: "answer", answers: { color: { values: [value] } } },
		});
	}
	const result = await flow.pending;
	assert.deepEqual(
		results.map((response) => (response as { ok: boolean }).ok),
		[false, true]
	);
	assert.equal(result.cancelled, false);
	assert.equal(flow.request.signal.aborted, true);
	flow.deliver({ kind: "cancel" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(flow.completed.length, 1);
	flow.runtime.disposeAll();
});
for (const cause of ["cancel", "abort"] as const) {
	test(`${cause} releases the external UI and ignores a late answer`, async () => {
		const abort = new AbortController();
		const flow = await pendingFlow(abort.signal);
		if (cause === "cancel") {
			flow.deliver({ kind: "cancel" });
		} else {
			abort.abort();
		}
		const result = await flow.pending;
		assert.equal(result.cancelled, true);
		assert.deepEqual(result.answers, {});
		assert.equal(flow.request.signal.aborted, true);
		flow.deliver(answer);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(flow.completed.length, 1);
		assert.equal(result.cancelled, true);
		flow.runtime.disposeAll();
	});
}

for (const response of [
	{ kind: "answer", mode: false, answers: {} },
	{ kind: "answer", mode: "", answers: {} },
	undefined,
	{ kind: "answer", answers: { wrong: { values: ["blue"] } } },
	{ kind: "answer", answers: { color: { values: ["wrong"] } } },
]) {
	test(`malformed external response is an error, not an answer: ${JSON.stringify(response)}`, async () => {
		const flow = await pendingFlow();
		flow.deliver(response);
		await assert.rejects(flow.pending, INVALID_RESPONSE_RE);
		assert.equal(flow.request.signal.aborted, true);
		assert.equal(flow.completed.length, 0);
		flow.runtime.disposeAll();
	});
}

test("UI failure is propagated and releases the surface for another call", async () => {
	const bus = eventBus();
	const runtime = createRemoteAskRuntime(bus as never);
	let request: ExternalAskRequest | undefined;
	await assert.rejects(
		runExternalAskFlow({
			provider: {
				...provider,
				open(input) {
					request = input;
					throw new Error("Disconnected");
				},
			},
			runtime,
			state: state(),
			toolCallId: "failed",
		}),
		DISCONNECTED_RE
	);
	assert.equal(request?.signal.aborted, true);
	const result = await runExternalAskFlow({
		provider,
		runtime,
		state: state(),
		toolCallId: "next",
	});
	assert.equal(result.cancelled, false);
	runtime.disposeAll();
});

test("external request preserves preview text and presentation but cannot mutate canonical options", async () => {
	const resolved = await resolvePreviewFiles(
		{
			questions: [
				{
					id: "color",
					type: "preview",
					prompt: "Choose?",
					options: [
						{
							value: "blue",
							label: "Blue",
							previewFile: "fixtures/preview.txt",
						},
					],
				},
			],
		},
		fileURLToPath(new URL("./", import.meta.url))
	);
	assert(resolved.ok);
	const initial = createInitialState(resolved.params);
	const bus = eventBus();
	const runtime = createRemoteAskRuntime(bus as never);
	const result = await runExternalAskFlow({
		provider: {
			...provider,
			open(request) {
				assert.equal(request.questions[0].type, "preview");
				assert.equal(
					request.questions[0].options[0].preview,
					initial.questions[0].options[0].preview
				);
				assert(request.questions[0].options[0].preview);
				assert.equal("previewFile" in request.questions[0].options[0], false);
				request.questions[0].options[0].label = "Fake label";
				return Promise.resolve(answer);
			},
		},
		runtime,
		state: initial,
		toolCallId: "preview",
	});
	assert.deepEqual(result.answers.color.labels, ["Blue"]);
	runtime.disposeAll();
});
