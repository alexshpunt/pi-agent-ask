import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { registerAskTool } from "../../src/ask-tool.ts";
import { createBackgroundAskRuntime } from "../../src/background-ask.ts";
import {
	createRemoteAskRuntime,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";
import { registerWaitForAnswersTool } from "../../src/wait-for-answers-tool.ts";

function contains(tree: unknown, target: Component): boolean {
	if (tree === target) {
		return true;
	}
	return (
		typeof tree === "object" &&
		tree !== null &&
		"children" in tree &&
		Array.isArray(tree.children) &&
		tree.children.some((child) => contains(child, target))
	);
}

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function recoveryEditorDriver(pi: ExtensionAPI): void {
	const remote = createRemoteAskRuntime(pi.events);
	const queue = createBackgroundAskRuntime(pi, remote);
	registerAskTool(pi, remote, queue);
	registerWaitForAnswersTool(pi, queue);
	const state: { active?: RemoteAskStartedEvent } = {};
	const currentFlow = (): RemoteAskStartedEvent | undefined => state.active;
	let isVisible: (() => boolean) | undefined;
	let ready: (() => void) | undefined;
	let mounted: (() => void) | undefined;
	let startedFlows = 0;
	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		startedFlows += 1;
		state.active = payload as RemoteAskStartedEvent;
		ready?.();
	});
	pi.on("session_start", (_event, ctx) => {
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (...args) => {
				const component = await factory(...args);
				isVisible = () => contains(args[0], component);
				if (component.handleInput) {
					setImmediate(() => mounted?.());
				}
				return component;
			}, options);
	});
	pi.registerTool({
		name: "restore_editor_probe",
		label: "Restore Editor Probe",
		description:
			"Restore a queue while a temporary native loading screen owns the editor.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) {
			queue.dispose();
			await new Promise<void>((resolve) => setImmediate(resolve));
			let closeLoading: (() => void) | undefined;
			const loading = ctx.ui.custom<void>((_tui, _theme, _keys, done) => {
				closeLoading = () => done();
				return {
					render: () => ["Restoring session resources"],
					invalidate: () => undefined,
				};
			});
			await new Promise<void>((resolve) => setImmediate(resolve));
			queue.restore(ctx);
			state.active = undefined;
			await new Promise<void>((resolve) => setImmediate(resolve));
			closeLoading?.();
			await loading;
			if (!state.active) {
				await new Promise<void>((resolve) => {
					ready = resolve;
				});
			}
			await new Promise<void>((resolve) => setImmediate(resolve));
			const flowsBeforeRemount = startedFlows;
			process.stdin.emit("data", "n");
			process.stdin.emit("data", "saved note");
			const remounted = new Promise<void>((resolve) => {
				const timeout = setTimeout(resolve, 500);
				mounted = () => {
					clearTimeout(timeout);
					resolve();
				};
			});
			// Real reload can restore the editor again after session_start already opened a form.
			ctx.ui.setEditorComponent(undefined);
			await remounted;
			await new Promise<void>((resolve) => setImmediate(resolve));
			const visible = isVisible?.() ?? false;
			const flow = currentFlow();
			if (!flow) {
				throw new Error("Recovered form did not open");
			}
			if (visible) {
				process.stdin.emit("data", "\r");
				await new Promise<void>((resolve) => setImmediate(resolve));
				process.stdin.emit("data", "\r");
				await new Promise<void>((resolve) => setImmediate(resolve));
				process.stdin.emit("data", "\r");
			} else {
				// Bound the red run without pretending keyboard input worked.
				pi.events.emit(PI_ASK_SUBMIT_EVENT, {
					version: 1,
					flowId: flow.flowId,
					requestId: "cleanup-invisible-form",
					response: {
						kind: "answer",
						answers: { choice: { values: ["yes"] } },
					},
				});
			}
			return {
				content: [{ type: "text", text: `Recovered form visible: ${visible}` }],
				details: { visible, newFlows: startedFlows - flowsBeforeRemount },
			};
		},
	});
}
