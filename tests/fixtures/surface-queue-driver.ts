import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getAskConfigStore } from "../../src/config/store.ts";
import askExtension from "../../src/index.ts";
import {
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskCompletedEvent,
	type RemoteAskStartedEvent,
} from "../../src/remote-ask.ts";

const ALT_Q = "\u001bq";
const ESCAPE = "\u001b[27u";
const DRAFT = "ordinary-surface-draft";

type ProbeContext = Parameters<
	Parameters<ExtensionAPI["registerTool"]>[0]["execute"]
>[4];

async function input(data: string): Promise<void> {
	process.stdin.emit("data", data);
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function paste(value: string): Promise<void> {
	return input(`\u001b[200~${value}\u001b[201~`);
}

async function until(predicate: () => boolean, message: string): Promise<void> {
	const deadline = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error(message);
		}
		await delay(10);
	}
	await new Promise<void>((resolve) => setImmediate(resolve));
}

function form(title: string, background: boolean) {
	return {
		background,
		title,
		questions: [
			{
				id: title,
				prompt: `Choose ${title}`,
				options: [{ value: "yes", label: "Yes" }],
			},
		],
	};
}

function recorded(ctx: ExtensionContext, title: string): boolean {
	return ctx.sessionManager
		.getBranch()
		.some(
			(entry) =>
				entry.type === "custom" &&
				entry.customType === "ask:history-request" &&
				(entry.data as { title?: string }).title === title
		);
}

export interface SurfaceQueueSnapshot {
	completed: RemoteAskCompletedEvent[];
	normalInput: string;
	started: string[];
}

// biome-ignore lint/style/noDefaultExport: Pi loads this isolated fixture by default export.
export default function surfaceQueueDriver(pi: ExtensionAPI): void {
	// Share the production entry point's module graph with the loading gates.
	askExtension(pi);
	const active = new Map<string, RemoteAskStartedEvent>();
	const completed: RemoteAskCompletedEvent[] = [];
	const started: string[] = [];
	const foregrounds = new Set<Component>();
	let panel: Component | undefined;

	pi.events.on(PI_ASK_STARTED_EVENT, (payload) => {
		const event = payload as RemoteAskStartedEvent;
		active.set(event.flowId, event);
		started.push(event.title ?? "");
	});
	pi.events.on(PI_ASK_COMPLETED_EVENT, (payload) => {
		const event = payload as RemoteAskCompletedEvent;
		active.delete(event.flowId);
		completed.push(event);
	});
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
			if (typeof content !== "function") {
				if (key === "ask:active-surface") {
					panel = undefined;
				}
				setWidget(key, content, options);
				return;
			}
			if (key !== "ask:active-surface") {
				setWidget(key, content, options);
				return;
			}
			setWidget(
				key,
				(tui, theme) => {
					panel = content(tui, theme);
					return panel;
				},
				options
			);
		};
	});

	function assertSingleVisible(): void {
		const visible =
			foregrounds.size + ((panel?.render(80).length ?? 0) > 0 ? 1 : 0);
		assert.equal(visible, 1, "Only one questionnaire may be visible");
	}

	async function answer(title: string, answerText: string): Promise<void> {
		await until(
			() => [...active.values()].some((flow) => flow.title === title),
			`Questionnaire ${title} did not open`
		);
		assertSingleVisible();
		await input("2");
		await paste(answerText);
		await input("\r");
		await input("\r");
		await until(
			() => completed.some((event) => event.result.title === title),
			`Keyboard input did not complete ${title}`
		);
	}

	async function finishVisibleForms(
		ctx: ExtensionContext,
		first: string,
		second: string,
		backgroundFirst: boolean,
		backgroundBatch: boolean
	): Promise<void> {
		assert.deepEqual(started, [first], "Second form overtook the active form");
		assertSingleVisible();
		if (backgroundFirst) {
			await input(ALT_Q);
			await paste("-kept");
			assert.equal(ctx.ui.getEditorText(), `${DRAFT}-kept`);
			await input(ALT_Q);
		}
		await answer(first, `${first}-typed`);
		if (backgroundBatch) {
			await answer("background-next", "background-next-typed");
		}
		await answer(second, `${second}-typed`);
	}

	async function finishDeferredForm(
		ctx: ExtensionContext,
		alreadyReopened: boolean
	): Promise<void> {
		if (!alreadyReopened) {
			ctx.ui.setEditorText("/ask-queue");
			await input("\r");
		}
		await until(
			() => (panel?.render(80).length ?? 0) > 0,
			"Deferred questionnaire did not reopen"
		);
		assertSingleVisible();
		await paste("-continued");
		await input("\r");
		await input("\r");
		await until(() => completed.length === 2, "Reopened draft did not submit");
	}
	async function prepareDraft(
		action: string,
		ctx: ExtensionContext &
			Pick<
				Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4],
				"executeTool"
			>
	): Promise<void> {
		if (action === "background_batch") {
			const receipt = await ctx.executeTool(
				"ask_user",
				form("background-next", true)
			);
			assert.equal(receipt.isError, false);
		}
		if (
			action === "deferred_background" ||
			action === "reopen_during_foreground"
		) {
			await input("2");
			await paste("saved-custom-draft");
			await input(ESCAPE);
		}
	}

	async function answerDeferredForeground(
		title: string,
		reopen: boolean
	): Promise<void> {
		if (reopen) {
			await until(() => started.includes(title), "Foreground did not open");
			await input(ALT_Q);
			assertSingleVisible();
		}
		await answer(title, "foreground-typed");
	}

	async function exerciseLoadingQueue(
		action: "reopen_during_loading" | "defer_during_loading",
		ctx: ProbeContext
	): Promise<void> {
		const reopen = action === "reopen_during_loading";
		if (reopen) {
			ctx.ui.setEditorText("/ask-defer");
			await input("\r");
		}
		const store = getAskConfigStore();
		const ensureLoaded = store.ensureLoaded.bind(store);
		let releaseBackground!: () => void;
		let releaseForeground!: () => void;
		const backgroundLoading = new Promise<void>((resolve) => {
			releaseBackground = resolve;
		});
		const foregroundLoading = new Promise<void>((resolve) => {
			releaseForeground = resolve;
		});
		let backgroundEntered = false;
		let foregroundEntered = false;
		let loads = 0;
		store.ensureLoaded = async () => {
			loads += 1;
			if (loads === 2) {
				backgroundEntered = true;
				await backgroundLoading;
			} else if (!reopen && loads === 4) {
				foregroundEntered = true;
				await foregroundLoading;
			}
			return ensureLoaded();
		};
		const controller = new AbortController();
		let foreground: ReturnType<typeof ctx.executeTool> | undefined;
		try {
			const receipt = await ctx.executeTool(
				"ask_user",
				form("background", true)
			);
			assert.equal(receipt.isError, false);
			await until(
				() => backgroundEntered,
				"Background runner did not begin loading"
			);
			assert.deepEqual(started, []);
			if (reopen) {
				const next = await ctx.executeTool(
					"ask_user",
					form("background-next", true)
				);
				assert.equal(next.isError, false);
			} else {
				ctx.ui.setEditorText("/ask-defer");
				await input("\r");
				foreground = ctx.executeTool("ask_user", form("foreground", false), {
					signal: controller.signal,
				});
				await until(
					() => foregroundEntered,
					"Deferred loading form retained the surface"
				);
			}
			ctx.ui.setEditorText("/ask-queue");
			await input("\r");
			ctx.ui.setEditorText(DRAFT);
			releaseBackground();
			if (reopen) {
				await answer("background", "background-typed");
				await answer("background-next", "background-next-typed");
			} else {
				await delay(30);
				assert.deepEqual(
					started,
					[],
					"Reopened background overtook the foreground"
				);
				releaseForeground();
				await answer("foreground", "foreground-typed");
				assert.equal((await foreground)?.isError, false);
				await answer("background", "background-typed");
			}
		} finally {
			releaseBackground();
			releaseForeground();
			store.ensureLoaded = ensureLoaded;
			controller.abort();
			cancelActive();
			await foreground;
		}
	}
	function cancelActive(): void {
		for (const flow of active.values()) {
			pi.events.emit(PI_ASK_SUBMIT_EVENT, {
				version: 1,
				flowId: flow.flowId,
				requestId: `cleanup-${flow.flowId}`,
				response: { kind: "cancel" },
			});
		}
	}
	async function exerciseMountedQueue(
		action: string,
		ctx: ProbeContext
	): Promise<void> {
		const controller = new AbortController();
		let foreground: ReturnType<typeof ctx.executeTool> | undefined;
		try {
			const backgroundFirst = action !== "foreground_first";
			const deferred =
				action === "deferred_background" ||
				action === "reopen_during_foreground";
			const [first, second] = backgroundFirst
				? ["background", "foreground"]
				: ["foreground", "background"];
			if (backgroundFirst) {
				const receipt = await ctx.executeTool("ask_user", form(first, true));
				assert.equal(receipt.isError, false);
			} else {
				foreground = ctx.executeTool("ask_user", form(first, false), {
					signal: controller.signal,
				});
			}
			await until(() => started.includes(first), "First form did not open");
			await prepareDraft(action, ctx);
			if (backgroundFirst) {
				foreground = ctx.executeTool("ask_user", form(second, false), {
					signal: controller.signal,
				});
			} else {
				const receipt = await ctx.executeTool("ask_user", form(second, true));
				assert.equal(receipt.isError, false);
			}
			await until(() => recorded(ctx, second), "Second request was not saved");
			await delay(30);
			if (deferred) {
				await answerDeferredForeground(
					second,
					action === "reopen_during_foreground"
				);
				assert.equal((await foreground)?.isError, false);
				await finishDeferredForm(ctx, action === "reopen_during_foreground");
			} else {
				await finishVisibleForms(
					ctx,
					first,
					second,
					backgroundFirst,
					action === "background_batch"
				);
				assert.equal((await foreground)?.isError, false);
			}
		} finally {
			controller.abort();
			cancelActive();
			await foreground;
		}
	}
	pi.registerTool({
		name: "surface_queue_probe",
		label: "Surface queue probe",
		description: "Exercise concurrent question requests through native input.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("background_first"),
				Type.Literal("foreground_first"),
				Type.Literal("deferred_background"),
				Type.Literal("background_batch"),
				Type.Literal("reopen_during_foreground"),
				Type.Literal("reopen_during_loading"),
				Type.Literal("defer_during_loading"),
			]),
		}),
		async execute(_id, { action }, _signal, _update, ctx) {
			await paste(DRAFT);
			if (
				action === "reopen_during_loading" ||
				action === "defer_during_loading"
			) {
				await exerciseLoadingQueue(action, ctx);
			} else {
				await exerciseMountedQueue(action, ctx);
			}
			assert.equal(foregrounds.size, 0);
			assert.equal(panel?.render(80).length ?? 0, 0);
			const details: SurfaceQueueSnapshot = {
				completed: [...completed],
				normalInput: ctx.ui.getEditorText(),
				started: [...started],
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});
}
