import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	ASK_ANSWER_MESSAGE,
	ASK_COMPLETED_ENTRY,
} from "../../src/background-ask-state.ts";
import {
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function settleAnswerDriver(pi: ExtensionAPI): void {
	let flow: RemoteAskStartedEvent | undefined;
	let phase: "work" | "settle" | "idle" | undefined;
	let cancel = false;
	let submittedAt: string | undefined;
	let started: (() => void) | undefined;
	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		flow = payload as RemoteAskStartedEvent;
		started?.();
		started = undefined;
	});
	const submit = async (at: string) => {
		assert(flow);
		submittedAt = at;
		const completed = new Promise<void>((resolve) => {
			const off = pi.events.on(PI_ASK_COMPLETED_EVENT, () => {
				off();
				resolve();
			});
		});
		pi.events.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			flowId: flow.flowId,
			requestId: `submit-${flow.toolCallId}`,
			response: cancel
				? { kind: "cancel" }
				: {
						kind: "answer",
						answers: Object.fromEntries(
							flow.questions.map((question) => [
								question.id,
								{ values: [question.options[0].value] },
							])
						),
					},
		});
		await completed;
		// Let the real form pump persist completion before the next boundary handler.
		await new Promise<void>((resolve) => setImmediate(resolve));
	};
	// Load before ask so this completion happens after turn_end but before ask's settle hook.
	pi.on("agent_before_settle", async () => {
		if (phase === "settle") {
			phase = undefined;
			await submit("settle");
		}
	});
	pi.on("agent_settled", () => {
		if (phase === "idle") {
			phase = undefined;
			setImmediate(() => submit("idle"));
		}
	});
	pi.registerTool({
		name: "settle_probe",
		label: "Settle probe",
		description:
			"Submit a real question form at a chosen lifecycle boundary and inspect delivery.",
		parameters: Type.Object({
			phase: Type.Optional(
				Type.Union([
					Type.Literal("work"),
					Type.Literal("settle"),
					Type.Literal("idle"),
				])
			),
			cancel: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (params.phase) {
				if (!flow) {
					await new Promise<void>((resolve) => {
						started = resolve;
					});
				}
				cancel = params.cancel ?? false;
				phase = params.phase;
				if (phase === "work") {
					phase = undefined;
					await submit("work");
				}
			}
			const branch = ctx.sessionManager.getBranch();
			const details = {
				submittedAt,
				completed: branch.filter(
					(entry) =>
						entry.type === "custom" && entry.customType === ASK_COMPLETED_ENTRY
				).length,
				answers: branch.filter(
					(entry) =>
						entry.type === "custom_message" &&
						entry.customType === ASK_ANSWER_MESSAGE
				).length,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});
}
