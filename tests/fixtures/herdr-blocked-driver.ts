import { execFile } from "node:child_process";
import { copyFileSync } from "node:fs";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

const exec = promisify(execFile);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

async function readStatus(): Promise<string> {
	if (process.env.ASK_HERDR_CORE === "1") {
		const { stdout } = await exec(
			"hc",
			["get", process.env.HC_TERMINAL_ID ?? "", "--json"],
			{ timeout: 5000 }
		);
		return JSON.parse(stdout).status?.state ?? "unknown";
	}
	const { stdout } = await exec(
		"herdr",
		["pane", "get", process.env.HERDR_PANE_ID ?? ""],
		{ timeout: 5000 }
	);
	return JSON.parse(stdout).result.pane.agent_status ?? "unknown";
}

async function waitForUnblocked(): Promise<string> {
	const deadline = Date.now() + 3000;
	let status = "blocked";
	do {
		status = await readStatus();
		if (status !== "blocked") {
			break;
		}
		await tick();
	} while (Date.now() < deadline);
	return status;
}

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function herdrBlockedDriver(pi: ExtensionAPI): void {
	const active = new Map<string, RemoteAskStartedEvent>();
	const observations: Array<{
		phase: string;
		status: string;
		question: string;
	}> = [];
	let answerOnIdle = false;
	let answerOnForeground = false;
	let answerOnWait = false;
	let saveOnIdle = false;
	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		const flow = payload as RemoteAskStartedEvent;
		active.set(flow.flowId, flow);
		if (answerOnForeground) {
			answerOnForeground = false;
			setImmediate(() => {
				observe("foreground", "foreground").then(answer);
			});
		}
	});
	pi.events.on(PI_ASK_COMPLETED_EVENT, (payload) => {
		active.delete((payload as { flowId: string }).flowId);
	});
	const observe = async (
		phase: string,
		question: string,
		expectedStatus = "blocked"
	) => {
		const deadline = Date.now() + 3000;
		let status = "unknown";
		do {
			status = await readStatus();
			const flow = active.values().next().value;
			if (flow?.questions[0]?.id === question && status === expectedStatus) {
				break;
			}
			await tick();
		} while (Date.now() < deadline);
		observations.push({
			phase,
			status,
			question: active.values().next().value?.questions[0]?.id ?? "none",
		});
	};
	const answer = () => {
		const flow = active.values().next().value;
		if (!flow) {
			throw new Error("No open form to answer");
		}
		pi.events.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			flowId: flow.flowId,
			requestId: `answer-${flow.flowId}`,
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
	pi.on("tool_execution_start", (event) => {
		if (answerOnWait && event.toolName === "wait_for_answers") {
			answerOnWait = false;
			setImmediate(() => {
				observe("explicit-wait", "first").then(answer);
			});
		}
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (saveOnIdle) {
			saveOnIdle = false;
			const source = ctx.sessionManager.getSessionFile();
			const target = process.env.ASK_HERDR_SAVED_SESSION;
			if (!(source && target)) {
				throw new Error("Missing session checkpoint path");
			}
			copyFileSync(source, target);
		}
		if (!answerOnIdle) {
			return;
		}
		answerOnIdle = false;
		setImmediate(() => {
			observe("idle", "second")
				.then(answer)
				.catch((error: unknown) => {
					observations.push({
						phase: "idle-error",
						status: String(error),
						question: "none",
					});
					answer();
				});
		});
	});
	pi.registerTool({
		name: "herdr_queue_probe",
		label: "Herdr Queue Probe",
		description: "Observe the real Herdr state while queued forms stay open.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("first"),
				Type.Literal("second"),
				Type.Literal("hide"),
				Type.Literal("reopen"),
				Type.Literal("idle"),
				Type.Literal("stats"),
				Type.Literal("checkpoint"),
				Type.Literal("recovered"),
				Type.Literal("foreground"),
				Type.Literal("wait"),
			]),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			switch (params.action) {
				case "foreground":
					answerOnForeground = true;
					break;
				case "wait":
					answerOnWait = true;
					break;
				case "first":
					await observe("working-first", "first");
					answer();
					await observe("handoff-second", "second");
					break;
				case "second":
					await observe("working-second", "second");
					break;
				case "hide":
					process.stdin.emit("data", "\u001b[27u");
					await observe("hidden", "second", "working");
					break;
				case "reopen":
					ctx.ui.setEditorText("/ask-queue");
					process.stdin.emit("data", "\r");
					await observe("reopened", "second");
					break;
				case "idle":
					answerOnIdle = true;
					break;
				case "checkpoint":
					saveOnIdle = true;
					break;
				case "recovered":
					await observe("recovered", "second");
					break;
				default:
					break;
			}
			const status =
				params.action === "stats"
					? await waitForUnblocked()
					: (observations.at(-1)?.status ?? "unknown");
			return {
				content: [{ type: "text", text: JSON.stringify(observations) }],
				details: {
					observations: [...observations],
					status,
					activeForms: active.size,
				},
			};
		},
	});
}
