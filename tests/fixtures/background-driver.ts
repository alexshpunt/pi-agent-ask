import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ASK_ANSWER_MESSAGE } from "../../src/background-ask-state.ts";
import {
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function backgroundDriver(pi: ExtensionAPI): void {
	const active = new Map<string, RemoteAskStartedEvent>();
	const blocked: unknown[] = [];
	let ready: (() => void) | undefined;
	let answerWhenIdle = false;
	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		const data = payload as RemoteAskStartedEvent;
		active.set(data.flowId, data);
		ready?.();
		ready = undefined;
	});
	pi.events.on(PI_ASK_COMPLETED_EVENT, (payload) => {
		active.delete((payload as { flowId: string }).flowId);
	});
	pi.events.on("herdr:blocked", (data) => blocked.push(data));
	const answerFirst = () => {
		const flow = active.values().next().value;
		if (!flow) {
			throw new Error("No active question form");
		}
		pi.events.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			flowId: flow.flowId,
			requestId: `submit-${flow.toolCallId}`,
			response: {
				kind: "answer",
				answers: Object.fromEntries(
					flow.questions.map((question) => [
						question.id,
						{ values: [question.options[0].value] },
					])
				),
			},
		});
	};
	pi.on("agent_settled", () => {
		if (answerWhenIdle) {
			answerWhenIdle = false;
			setImmediate(answerFirst);
		}
	});
	pi.on("tool_call", (event) => {
		if (event.toolName === "wait_for_answers") {
			setImmediate(answerFirst);
		}
	});
	pi.registerTool({
		name: "queue_probe",
		label: "Queue Probe",
		description:
			"Independent research and queue observations for integration tests.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("research"),
				Type.Literal("stats"),
				Type.Literal("answer_idle"),
			]),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (params.action === "answer_idle") {
				answerWhenIdle = true;
				return {
					content: [
						{ type: "text", text: "Will answer once the agent settles." },
					],
					details: {},
				};
			}
			if (params.action === "research") {
				if (!active.size) {
					await new Promise<void>((resolve) => {
						ready = resolve;
					});
				}
				const document = await readFile(
					new URL("../../README.md", import.meta.url),
					"utf8"
				);
				const beforeAnswer = {
					activeForms: active.size,
					blocked: [...blocked],
					readSucceeded: document.includes("pi-agent-ask"),
				};
				answerFirst();
				await new Promise<void>((resolve) => setImmediate(resolve));
				return {
					content: [
						{
							type: "text",
							text: "Independent research finished before answer.",
						},
					],
					details: beforeAnswer,
				};
			}
			const branch = ctx.sessionManager.getBranch();
			const details = {
				answerMessages: branch.filter(
					(entry) =>
						entry.type === "custom_message" &&
						entry.customType === ASK_ANSWER_MESSAGE
				).length,
				activeForms: active.size,
				blocked,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});
}
