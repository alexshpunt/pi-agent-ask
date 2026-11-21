import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ASK_ANSWER_MESSAGE } from "../../src/background-ask-state.ts";
import {
	type ExtensionAskAnsweredEvent,
	PI_ASK_ANSWERED_EVENT,
	requestExtensionAsk,
} from "../../src/extension-ask.ts";
import {
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

interface AnsweredRecord
	extends Omit<ExtensionAskAnsweredEvent, "deliverQuietly"> {
	answerMessagesBefore: number;
}

const reply = (details: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(details ?? null) }],
	details: details ?? null,
});

function answerMessages(ctx: ExtensionContext | undefined): number {
	return (
		ctx?.sessionManager
			.getBranch()
			.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === ASK_ANSWER_MESSAGE
			).length ?? 0
	);
}

function enqueue(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	toolCallId: string,
	action: "enqueue" | "enqueue_invalid" | "enqueue_unowned"
) {
	const value = "confirm";
	const invalid = action === "enqueue_invalid";
	return requestExtensionAsk(pi.events, {
		ctx,
		owner: action === "enqueue_unowned" ? "" : "probe",
		toolCallId,
		params: {
			title: "Probe goal",
			questions: [
				{
					id: "goal",
					prompt: "Confirm the goal?",
					options: invalid
						? [
								{ value, label: "Confirm" },
								{ value, label: "Again" },
							]
						: [{ value, label: "Confirm" }],
				},
			],
		},
	});
}

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function extensionAskDriver(pi: ExtensionAPI): void {
	const started: RemoteAskStartedEvent[] = [];
	const answered: AnsweredRecord[] = [];
	let context: ExtensionContext | undefined;
	let onAnswered: (() => void) | undefined;
	let turnAnswer: "loud" | "quiet" | undefined;
	let quiet = false;
	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		started.push(payload as RemoteAskStartedEvent);
	});
	pi.events.on(PI_ASK_ANSWERED_EVENT, (payload) => {
		const event = payload as ExtensionAskAnsweredEvent;
		if (quiet) {
			event.deliverQuietly();
		}
		const { deliverQuietly: _callback, ...record } = event;
		answered.push({
			...record,
			answerMessagesBefore: answerMessages(context),
		});
		onAnswered?.();
	});
	// Answer while the next turn streams, so the answer reaches its final boundary.
	pi.on("turn_start", () => {
		if (turnAnswer) {
			quiet = turnAnswer === "quiet";
			turnAnswer = undefined;
			setImmediate(() => {
				answer().catch(() => undefined);
			});
		}
	});
	const answer = async () => {
		const flow = started.at(-1);
		if (!flow) {
			throw new Error("No started form");
		}
		const done = new Promise<void>((resolve) => {
			onAnswered = resolve;
		});
		pi.events.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			flowId: flow.flowId,
			requestId: "probe-submit",
			response: { kind: "answer", answers: { goal: { values: ["confirm"] } } },
		});
		await done;
		return reply({ answered: true });
	};
	pi.registerTool({
		name: "extension_probe",
		label: "Extension Probe",
		description: "Queues and answers extension-owned forms in tests.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("enqueue"),
				Type.Literal("enqueue_invalid"),
				Type.Literal("enqueue_unowned"),
				Type.Literal("answer"),
				Type.Literal("answer_next_turn"),
				Type.Literal("answer_next_turn_quiet"),
				Type.Literal("stats"),
			]),
		}),
		async execute(toolCallId, params, _signal, _update, ctx) {
			context = ctx;
			if (
				params.action === "answer_next_turn" ||
				params.action === "answer_next_turn_quiet"
			) {
				turnAnswer =
					params.action === "answer_next_turn_quiet" ? "quiet" : "loud";
				return reply({ armed: true });
			}
			if (params.action === "answer") {
				return await answer();
			}
			if (params.action === "stats") {
				return reply({ answered, answerMessages: answerMessages(ctx) });
			}
			return reply(await enqueue(pi, ctx, toolCallId, params.action));
		},
	});
}
