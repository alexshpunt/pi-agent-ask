import { readFile } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ASK_ANSWER_MESSAGE } from "../../src/background-ask-state.ts";
import { getAskConfigPath, getAskConfigStore } from "../../src/config/store.ts";
import {
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

// biome-ignore lint/style/noDefaultExport: Pi loads fixture extensions through a default factory.
export default function backgroundOnlyDriver(pi: ExtensionAPI): void {
	const active = new Map<string, RemoteAskStartedEvent>();
	const scheduled = new Set<string>();
	const blocked: boolean[] = [];
	const confirmations: boolean[] = [];
	let confirmationAnswer = false;
	let commandComplete: (() => void) | undefined;
	let formReady: (() => void) | undefined;
	let formsFinished: (() => void) | undefined;
	let completed = 0;
	let answerOnSettle = false;
	let draining = false;
	let startupSwitch = process.env.ASK_BACKGROUND_ONLY_START_NORMAL === "1";

	const answer = (flow: RemoteAskStartedEvent) => {
		if (!active.has(flow.flowId) || scheduled.has(flow.flowId)) {
			return;
		}
		scheduled.add(flow.flowId);
		setImmediate(() => {
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
		});
	};
	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		const flow = payload as RemoteAskStartedEvent;
		active.set(flow.flowId, flow);
		formReady?.();
		formReady = undefined;
		if (draining) {
			answer(flow);
		}
	});
	pi.events.on(PI_ASK_COMPLETED_EVENT, (payload) => {
		active.delete((payload as { flowId: string }).flowId);
		completed += 1;
		if (completed === 2) {
			formsFinished?.();
			formsFinished = undefined;
		}
	});
	pi.events.on("herdr:blocked", (payload) => {
		blocked.push((payload as { active: boolean }).active);
	});

	const changeMode = (backgroundOnly: boolean) =>
		new Promise<void>((resolve) => {
			commandComplete = resolve;
			pi.sendUserMessage(
				`/ask-mode global ${backgroundOnly ? "background-only" : "normal"}`,
				{ expandPromptTemplates: true }
			);
		});

	pi.on("session_start", async (_event, ctx) => {
		// The extension factory resets the singleton after this driver loads.
		const store = getAskConfigStore();
		const config = await store.getConfig();
		await store.save({
			...config,
			behaviour: { ...config.behaviour, backgroundOnly: true },
			notifications: { ...config.notifications, enabled: false },
		});
		const notify = ctx.ui.notify.bind(ctx.ui);
		ctx.ui.notify = (...args) => {
			notify(...args);
			const finish = commandComplete;
			commandComplete = undefined;
			finish?.();
		};
		ctx.ui.confirm = () => {
			confirmations.push(confirmationAnswer);
			return Promise.resolve(confirmationAnswer);
		};
	});
	pi.on("before_agent_start", async () => {
		if (startupSwitch) {
			startupSwitch = false;
			await changeMode(false);
		}
	});
	pi.on("agent_settled", () => {
		if (!answerOnSettle) {
			return;
		}
		answerOnSettle = false;
		draining = true;
		for (const flow of active.values()) {
			answer(flow);
		}
	});

	const inspect = async (ctx: ExtensionToolContext) => {
		const saved = JSON.parse(await readFile(getAskConfigPath(), "utf8"));
		return {
			activeForms: active.size,
			answerMessages: ctx.sessionManager
				.getBranch()
				.filter(
					(entry) =>
						entry.type === "custom_message" &&
						entry.customType === ASK_ANSWER_MESSAGE
				).length,
			blocked: [...blocked],
			completed,
			confirmations: [...confirmations],
			savedMode: saved.behaviour.backgroundOnly as boolean,
			waitActive: pi.getActiveTools().includes("wait_for_answers"),
			waitCallable: ctx.tools.some((tool) => tool.name === "wait_for_answers"),
			waitExposure: pi
				.getAllTools()
				.find((tool) => tool.name === "wait_for_answers")?.exposure,
		};
	};
	const waitForForm = async () => {
		if (active.size) {
			return;
		}
		await new Promise<void>((resolve) => {
			formReady = resolve;
		});
	};
	const finishDraining = async () => {
		if (!draining || completed >= 2) {
			return;
		}
		await new Promise<void>((resolve) => {
			formsFinished = resolve;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
	};
	pi.registerTool({
		name: "background_only_probe",
		label: "Background-only probe",
		description: "Control and inspect background-only integration scenarios.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("reactivate_wait"),
				Type.Literal("research"),
				Type.Literal("stats"),
				Type.Literal("switch"),
			]),
			confirm: Type.Optional(Type.Boolean()),
			backgroundOnly: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (params.action === "reactivate_wait") {
				pi.setActiveTools([...pi.getActiveTools(), "wait_for_answers"]);
			}
			if (params.action === "switch") {
				confirmationAnswer = params.confirm ?? false;
				await changeMode(params.backgroundOnly ?? false);
			}
			if (params.action === "research") {
				await waitForForm();
				const manifest = JSON.parse(
					await readFile(new URL("../../package.json", import.meta.url), "utf8")
				);
				answerOnSettle = true;
				const details = {
					...(await inspect(ctx)),
					independentPackage: manifest.name,
				};
				return {
					content: [{ type: "text", text: "Independent research completed." }],
					details,
				};
			}
			if (params.action === "stats") {
				await finishDraining();
			}
			const details = await inspect(ctx);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});
}
