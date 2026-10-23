import { execFileSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskCompletedEvent,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

const ALT_Q = "\u001bq";
const ESCAPE = "\u001b[27u";
const USER_MESSAGE =
	"Please keep the questions and discuss this message instead.";

export interface NonModalSnapshot {
	activeToolCalls: Array<string | undefined>;
	answerMessages: number;
	blocked: unknown[];
	completed: RemoteAskCompletedEvent[];
	draftText?: string;
	hidden: boolean;
	normalInput: string;
	panel: string;
	panelRows: number;
	pendingRequestIds: string[];
	terminalSize: { cols: number; rows: number };
	userInputs: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Feed the real terminal parser, listeners, focus router, and native editor. */
async function input(data: string): Promise<void> {
	process.stdin.emit("data", data);
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function paste(text: string): Promise<void> {
	return input(`\u001b[200~${text}\u001b[201~`);
}

function resizeTerminal(): Promise<void> {
	return new Promise((resolve, reject) => {
		const onResize = () => {
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(() => {
			process.stdout.off("resize", onResize);
			reject(new Error("The owned test terminal did not report its resize."));
		}, 2000);
		process.stdout.once("resize", onResize);
		try {
			execFileSync("stty", ["cols", "60", "rows", "18"], {
				stdio: ["inherit", "pipe", "pipe"],
			});
		} catch (error) {
			clearTimeout(timeout);
			process.stdout.off("resize", onResize);
			reject(error);
		}
	});
}
function submitAnswer(pi: ExtensionAPI, flow: RemoteAskStartedEvent): void {
	pi.events.emit(PI_ASK_SUBMIT_EVENT, {
		version: 1,
		flowId: flow.flowId,
		requestId: `complete-${flow.toolCallId}`,
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
}
// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function nonModalDriver(pi: ExtensionAPI): void {
	const active = new Map<string, RemoteAskStartedEvent>();
	const completed: RemoteAskCompletedEvent[] = [];
	const blocked: unknown[] = [];
	const userInputs: string[] = [];
	let panel: Component | undefined;
	let nextWait: "escape" | "message" | undefined;
	let waitingForForm: (() => void) | undefined;
	let waitingForCompletion: (() => void) | undefined;
	let inputFailure: unknown;
	let overlap = false;

	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		const event = payload as RemoteAskStartedEvent;
		active.set(event.flowId, event);
		if (overlap && event.toolCallId === "overlap-foreground") {
			setImmediate(() => submitAnswer(pi, event));
		}
		waitingForForm?.();
		waitingForForm = undefined;
	});
	pi.events.on(PI_ASK_COMPLETED_EVENT, (payload) => {
		const event = payload as RemoteAskCompletedEvent;
		active.delete(event.flowId);
		completed.push(event);
		waitingForCompletion?.();
		waitingForCompletion = undefined;
	});
	pi.events.on("herdr:blocked", (payload) => blocked.push(payload));
	pi.on("tool_execution_end", (event) => {
		if (!overlap || event.toolCallId !== "overlap-foreground") {
			return;
		}
		overlap = false;
		const pending = active.values().next().value;
		if (pending) {
			setImmediate(() => submitAnswer(pi, pending));
		}
	});
	pi.on("input", (event) => {
		if (event.source === "interactive") {
			userInputs.push(event.text);
		}
	});
	pi.on("session_start", (_event, ctx) => {
		const setWidget = ctx.ui.setWidget.bind(ctx.ui);
		ctx.ui.setWidget = (
			key: string,
			content:
				| string[]
				| undefined
				| ((tui: TUI, theme: Theme) => Component & { dispose?(): void }),
			options
		) => {
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
			if (key === "ask:active-surface" && content === undefined) {
				panel = undefined;
			}
			setWidget(key, content, options);
		};
	});
	pi.on("tool_call", (event) => {
		if (event.toolName !== "wait_for_answers" || !nextWait) {
			return;
		}
		const action = nextWait;
		nextWait = undefined;
		setImmediate(() => {
			const send =
				action === "escape"
					? input(ESCAPE)
					: paste(USER_MESSAGE).then(() => input("\r"));
			send.catch((error: unknown) => {
				inputFailure = error;
			});
		});
	});

	async function formReady(): Promise<void> {
		if (!active.size) {
			await new Promise<void>((resolve) => {
				waitingForForm = resolve;
			});
		}
		await new Promise<void>((resolve) => setImmediate(resolve));
	}

	function snapshot(ctx: ExtensionContext): NonModalSnapshot {
		if (inputFailure) {
			throw inputFailure;
		}
		const branch = ctx.sessionManager.getBranch();
		const custom = branch.flatMap((entry) =>
			entry.type === "custom"
				? [{ kind: entry.customType, data: record(entry.data) }]
				: []
		);
		const ids = (kind: string) =>
			custom.flatMap((entry) =>
				entry.kind === kind && typeof entry.data?.requestId === "string"
					? [entry.data.requestId]
					: []
			);
		const completedIds = new Set(ids("ask:queue-completed"));
		const pending = ids("ask:queued").filter((id) => !completedIds.has(id));
		const visibility = custom
			.filter((entry) => entry.kind === "ask:queue-ui")
			.at(-1)?.data;
		const hidden = visibility?.hidden === true;
		const draft = record(
			custom.filter((entry) => entry.kind === "ask:queue-draft").at(-1)?.data
				?.draft
		);
		const draftText =
			typeof draft?.editorText === "string" ? draft.editorText : undefined;
		const answerMessages = branch.filter(
			(entry) =>
				entry.type === "custom_message" &&
				entry.customType === "ask:background-answer"
		).length;
		const terminalSize = {
			cols: process.stdout.columns ?? 120,
			rows: process.stdout.rows ?? 24,
		};
		const panelLines = panel?.render(terminalSize.cols) ?? [];
		return {
			activeToolCalls: [...active.values()].map((flow) => flow.toolCallId),
			answerMessages,
			blocked: [...blocked],
			completed: [...completed],
			draftText,
			hidden,
			normalInput: ctx.ui.getEditorText(),
			panel: stripVTControlCharacters(panelLines.join("\n")),
			panelRows: panelLines.length,
			terminalSize,
			pendingRequestIds: [...pending],
			userInputs: [...userInputs],
		};
	}

	pi.registerTool({
		name: "non_modal_probe",
		label: "Non-modal Probe",
		description:
			"Exercise actual terminal input and observe queued question behavior.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("draft_message"),
				Type.Literal("skip_first"),
				Type.Literal("answer_focused"),
				Type.Literal("type_after_empty"),
				Type.Literal("arm_escape"),
				Type.Literal("arm_message"),
				Type.Literal("arm_overlap"),
				Type.Literal("resize"),
				Type.Literal("reopen"),
				Type.Literal("answer"),
				Type.Literal("snapshot"),
			]),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			switch (params.action) {
				case "draft_message":
					await paste("ordinary-editor-draft");
					break;
				case "skip_first": {
					await formReady();
					await paste("-still-typing");
					if (ctx.ui.getEditorText() !== "ordinary-editor-draft-still-typing") {
						throw new Error(
							"The question panel captured input meant for the ordinary editor."
						);
					}
					await input(ALT_Q);
					await input("d");
					await input("1");
					const finished = new Promise<void>((resolve) => {
						waitingForCompletion = resolve;
					});
					await input("1");
					await input("1");
					await finished;
					await new Promise<void>((resolve) => setImmediate(resolve));
					break;
				}
				case "answer_focused": {
					const finished = new Promise<void>((resolve) => {
						waitingForCompletion = resolve;
					});
					await input("1");
					await input("1");
					await input("1");
					await finished;
					await new Promise<void>((resolve) => setImmediate(resolve));
					break;
				}
				case "type_after_empty":
					await formReady();
					await paste("-after-empty");
					break;
				case "arm_escape":
					await formReady();
					await input(ALT_Q);
					await input("\u001b[B");
					await paste("saved-answer-draft");
					nextWait = "escape";
					break;
				case "arm_message":
					await formReady();
					nextWait = "message";
					break;
				case "arm_overlap":
					await formReady();
					overlap = true;
					break;
				case "resize":
					await formReady();
					await resizeTerminal();
					await paste("-resized");
					break;
				case "reopen":
					ctx.ui.setEditorText("/ask-queue");
					await input("\r");
					break;
				case "answer": {
					const flow = active.values().next().value;
					if (!flow) {
						throw new Error("No active questionnaire to answer");
					}
					submitAnswer(pi, flow);
					await new Promise<void>((resolve) => setImmediate(resolve));
					break;
				}
				default:
					break;
			}
			const details = snapshot(ctx);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});
}
