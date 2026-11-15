import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { appendAskHistoryRequest } from "../../src/ask-history.ts";
import { registerAskTool } from "../../src/ask-tool.ts";
import { createBackgroundAskRuntime } from "../../src/background-ask.ts";
import {
	createRemoteAskRuntime,
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	type RemoteAskCompletedEvent,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";
import { registerPendingAskResume } from "../../src/resume-pending-ask.ts";
import { createInitialState } from "../../src/state/create.ts";

async function input(value: string): Promise<void> {
	process.stdin.emit("data", value);
	await new Promise<void>((resolve) => setImmediate(resolve));
}

async function until(predicate: () => boolean, message: string): Promise<void> {
	const deadline = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error(message);
		}
		await delay(10);
	}
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function form(title: string) {
	return {
		title,
		questions: [
			{
				id: title,
				prompt: `Recover ${title}`,
				options: [{ value: "yes", label: "Yes" }],
			},
		],
	};
}

/** Runs production recovery handlers against a real persisted branch and native Pi UI. */
// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function mixedSurfaceRecoveryDriver(pi: ExtensionAPI): void {
	const remote = createRemoteAskRuntime(pi.events);
	const background = createBackgroundAskRuntime(pi, remote);
	registerAskTool(pi, remote, background);
	const hooks = new Map<
		string,
		(event: never, ctx: ExtensionContext) => unknown
	>();
	const recoveryPi = {
		...pi,
		on(
			event: string,
			handler: (event: never, ctx: ExtensionContext) => unknown
		) {
			hooks.set(event, handler);
			return pi.on(event as never, handler as never);
		},
	} as ExtensionAPI;
	registerPendingAskResume(recoveryPi, remote, background);
	const started: string[] = [];
	const completed: RemoteAskCompletedEvent[] = [];
	let panel: Component | undefined;
	const foregrounds = new Set<Component>();
	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		started.push((payload as RemoteAskStartedEvent).title ?? "");
	});
	pi.events.on(PI_ASK_COMPLETED_EVENT, (payload) =>
		completed.push(payload as RemoteAskCompletedEvent)
	);
	pi.on("session_start", (_event, ctx) => {
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (tui, theme, keys, done) => {
				const component = await factory(tui, theme, keys, done);
				if (!options?.overlay) {
					foregrounds.add(component);
					const dispose = component.dispose?.bind(component);
					component.dispose = () => {
						foregrounds.delete(component);
						dispose?.();
					};
				}
				return component;
			}, options);
		const setWidget = ctx.ui.setWidget.bind(ctx.ui);
		ctx.ui.setWidget = (key, content, options) => {
			if (key === "ask:active-surface" && typeof content === "function") {
				setWidget(
					key,
					(tui, theme) => {
						panel = content(tui, theme);
						return panel;
					},
					options
				);
				return;
			}
			if (typeof content === "function") {
				setWidget(key, content, options);
				return;
			}
			if (key === "ask:active-surface") {
				panel = undefined;
			}
			setWidget(key, content, options);
		};
	});

	function assertOneVisible(): void {
		assert.equal(
			foregrounds.size + Number((panel?.render(80).length ?? 0) > 0),
			1
		);
	}

	async function answer(title: string): Promise<void> {
		await until(
			() => started.includes(title),
			`Recovered ${title} did not open`
		);
		assertOneVisible();
		await input("2");
		await input(`\u001b[200~${title}-typed\u001b[201~`);
		await input("\r");
		await input("\r");
		await until(
			() => completed.some((event) => event.result.title === title),
			`Recovered ${title} did not accept keyboard input`
		);
	}

	pi.registerTool({
		name: "mixed_recovery_probe",
		label: "Mixed recovery probe",
		description:
			"Restore persisted foreground and background forms through native Pi UI.",
		parameters: Type.Object({ backgroundFirst: Type.Boolean() }),
		async execute(_id, { backgroundFirst }, _signal, _update, ctx) {
			const foregroundParams = form("foreground-recovered");
			const backgroundParams = form("background-recovered");
			const manager = ctx.sessionManager as SessionManager;
			const assistant = [...manager.getBranch()]
				.reverse()
				.find(
					(entry) =>
						entry.type === "message" && entry.message.role === "assistant"
				);
			assert(
				assistant?.type === "message" && assistant.message.role === "assistant"
			);
			manager.appendMessage({
				...assistant.message,
				content: [
					{
						type: "toolCall",
						id: "recover-foreground",
						name: "ask_user",
						arguments: { ...foregroundParams },
					},
				],
				stopReason: "toolUse",
				timestamp: Date.now(),
			});
			const appendForeground = () =>
				appendAskHistoryRequest(
					pi,
					"recover-foreground",
					createInitialState(foregroundParams),
					false
				);
			const appendBackground = () =>
				appendAskHistoryRequest(
					pi,
					"recover-background",
					createInitialState(backgroundParams),
					true
				);
			let requestId: string;
			if (backgroundFirst) {
				requestId = appendBackground();
				appendForeground();
			} else {
				appendForeground();
				requestId = appendBackground();
			}
			pi.appendEntry("ask:queued", {
				version: 1,
				requestId,
				toolCallId: "recover-background",
				params: backgroundParams,
				presentSingleAsMulti: false,
			});
			try {
				hooks.get("session_start")?.(
					{ type: "session_start", reason: "resume" } as never,
					ctx
				);
				hooks.get("resources_discover")?.(
					{ type: "resources_discover" } as never,
					ctx
				);
				const order = backgroundFirst
					? ["background-recovered", "foreground-recovered"]
					: ["foreground-recovered", "background-recovered"];
				await until(() => started.length > 0, "No recovered form opened");
				await delay(30);
				assert.deepEqual(
					started,
					[order[0]],
					"Recovery opened forms concurrently or out of arrival order"
				);
				await answer(order[0]);
				await answer(order[1]);
				await new Promise<void>((resolve) => setImmediate(resolve));
				assert.equal(foregrounds.size, 0);
				assert.equal(panel?.render(80).length ?? 0, 0);
				const details = {
					started: [...started],
					completed: completed.map((event) => event.result),
					pending: background.pendingCount(),
				};
				return {
					content: [{ type: "text", text: JSON.stringify(details) }],
					details,
				};
			} finally {
				hooks.get("session_shutdown")?.(
					{ type: "session_shutdown" } as never,
					ctx
				);
				background.dispose();
				remote.disposeAll();
			}
		},
	});
}
