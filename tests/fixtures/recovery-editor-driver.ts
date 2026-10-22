import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { registerAskTool } from "../../src/ask-tool.ts";
import { registerBackgroundAnswerRenderer } from "../../src/background-answer.ts";
import { createBackgroundAskRuntime } from "../../src/background-ask.ts";
import {
	createRemoteAskRuntime,
	PI_ASK_STARTED_EVENT,
} from "../../src/remote-ask.ts";
import { registerWaitForAnswersTool } from "../../src/wait-for-answers-tool.ts";

async function input(data: string): Promise<void> {
	process.stdin.emit("data", data);
	await new Promise<void>((resolve) => setImmediate(resolve));
}

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function recoveryEditorDriver(pi: ExtensionAPI): void {
	const remote = createRemoteAskRuntime(pi.events);
	const queue = createBackgroundAskRuntime(pi, remote);
	registerBackgroundAnswerRenderer(pi);
	registerAskTool(pi, remote, queue);
	registerWaitForAnswersTool(pi, queue);
	let panel: Component | undefined;
	let ready: (() => void) | undefined;
	let startedFlows = 0;
	pi.events.on(PI_ASK_STARTED_EVENT, (_payload: unknown) => {
		startedFlows += 1;
		ready?.();
		ready = undefined;
	});
	pi.on("session_start", (_event, ctx) => {
		const setWidget = ctx.ui.setWidget.bind(ctx.ui);
		ctx.ui.setWidget = (key, content, options) => {
			if (typeof content === "function") {
				setWidget(
					key,
					(tui, theme) => {
						const widget = content(tui, theme);
						if (key === "ask:active-surface") {
							panel = widget;
						}
						return widget;
					},
					options
				);
				return;
			}
			if (key === "ask:active-surface") {
				panel = undefined;
			}
			setWidget(key, content, options);
		};
	});
	pi.registerTool({
		name: "restore_editor_probe",
		label: "Restore Editor Probe",
		description:
			"Recover pending questions and a raw draft while the native editor is replaced.",
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
			const restored = new Promise<void>((resolve) => {
				ready = resolve;
			});
			queue.restore(ctx);
			closeLoading?.();
			await loading;
			await restored;
			await input("\u001bq");
			await input("n");
			await input("\u001b[200~saved note\u001b[201~");

			// Rebuild the runtime as reload/resume does, including the raw unsaved note text.
			const draftRestored = new Promise<void>((resolve) => {
				ready = resolve;
			});
			queue.restore(ctx);
			await draftRestored;
			await new Promise<void>((resolve) => setImmediate(resolve));
			const flowsBeforeEditorReset = startedFlows;
			ctx.ui.setEditorComponent(undefined);
			await input("\u001bq");
			const rendered = panel?.render(120).join("\n") ?? "";
			const visible =
				rendered.includes("Recovered question?") &&
				rendered.includes("saved note");
			if (!visible) {
				throw new Error(
					"The recovered question panel or its note draft was lost."
				);
			}
			await input("\r");
			await input("\r");
			await input("\r");
			return {
				content: [{ type: "text", text: `Recovered form visible: ${visible}` }],
				details: { visible, newFlows: startedFlows - flowsBeforeEditorReset },
			};
		},
	});
}
