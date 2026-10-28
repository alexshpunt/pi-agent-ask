import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import type {
	ExtensionAPI,
	SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	ASK_ANSWER_MESSAGE,
	ASK_COMPLETED_ENTRY,
	ASK_QUEUED_ENTRY,
} from "../../src/background-ask-state.ts";
import {
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

function isQueueRecord(entry: SessionEntry): boolean {
	return (
		entry.type === "custom" &&
		(entry.customType === ASK_QUEUED_ENTRY ||
			entry.customType === ASK_COMPLETED_ENTRY)
	);
}

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
			setImmediate(() => {
				if (active.size) {
					answerFirst();
				}
			});
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
				Type.Literal("drop_queue_records"),
			]),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (params.action === "drop_queue_records") {
				const file = ctx.sessionManager.getSessionFile();
				assert(file, "Expected a persisted integration session");
				const entries = ctx.sessionManager
					.getBranch()
					.filter((entry) => !isQueueRecord(entry));
				// Reproduce a transcript replacement without reloading the extension runtime.
				const retained = entries.map((entry, index) => ({
					...entry,
					parentId: entries[index - 1]?.id ?? null,
				}));
				await writeFile(
					file,
					`${[ctx.sessionManager.getHeader(), ...retained]
						.map((entry) => JSON.stringify(entry))
						.join("\n")}\n`
				);
				(ctx.sessionManager as SessionManager).setSessionFile(file);
			}

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
				queueRecords: branch.filter(isQueueRecord).length,
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
