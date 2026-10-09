import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { AskQueuedSchema } from "../../src/background-ask-state.ts";
import {
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";
import { AskResultSchema } from "../../src/result-schema.ts";

// biome-ignore lint/style/noDefaultExport: Pi loads fixture extensions through a default factory.
export default function historyDriver(pi: ExtensionAPI): void {
	const requests = new Map<string, string>();
	let pending: RemoteAskStartedEvent | undefined;
	const submit = (flow: RemoteAskStartedEvent) => {
		pi.events.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			flowId: flow.flowId,
			requestId: `submit-${flow.toolCallId}`,
			response: {
				kind: "answer",
				answers: {
					scope: {
						values: ["small"],
						customText: "Custom choice",
						note: "Question note",
						optionNotes: { small: "Option note" },
					},
					preview: { values: ["doc"] },
				},
			},
		});
	};
	pi.events.on(PI_ASK_STARTED_EVENT, (data) => {
		const flow = data as RemoteAskStartedEvent;
		if (flow.toolCallId === "background") {
			pending = flow;
		} else {
			setTimeout(() => submit(flow), 100);
		}
	});
	pi.on("tool_result", (event) => {
		if (event.toolName !== "ask_user") {
			return;
		}
		if (
			(Value.Check(AskResultSchema, event.details) ||
				Value.Check(AskQueuedSchema, event.details)) &&
			event.details.requestId
		) {
			requests.set(event.toolCallId, event.details.requestId);
		}
	});
	pi.on("tool_call", (event) => {
		if (event.toolName === "wait_for_answers") {
			if (!pending) {
				throw new Error("Background form did not open");
			}
			const flow = pending;
			setImmediate(() => submit(flow));
		}
		const resolve = (key: Record<string, unknown>) => ({
			...key,
			requestId: requests.get(String(key.requestId)) ?? key.requestId,
		});
		if (event.toolName === "read_ask_history") {
			Object.assign(event.input, resolve(event.input));
		}
		if (
			event.toolName === "export_ask_history" &&
			Array.isArray(event.input.keys)
		) {
			event.input.keys = event.input.keys.map(resolve);
		}
		return;
	});
}
