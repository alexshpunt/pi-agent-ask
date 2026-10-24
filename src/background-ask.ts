import type {
	BoundaryResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBoundaryDraft,
} from "@earendil-works/pi-coding-agent";
import type { AskDraft } from "./ask-draft.ts";
import { appendAskHistoryCompletion } from "./ask-history.ts";
import { formatQueuedAnswer } from "./background-answer.ts";
import {
	ASK_ANSWER_MESSAGE,
	ASK_COMPLETED_ENTRY,
	ASK_DRAFT_ENTRY,
	ASK_QUEUE_UI_ENTRY,
	ASK_QUEUED_ENTRY,
	type QueuedAnswer,
	type QueuedRequest,
	restoreQueuedRequests,
	restoreQueueHidden,
	type WaitForAnswersResult,
} from "./background-ask-state.ts";
import { beginUserWait } from "./herdr-wait-state.ts";
import { imageContent } from "./images.ts";
import type { RemoteAskRuntime } from "./remote-ask.ts";
import type { AskParams } from "./types.ts";
import { runAskFlow } from "./ui/controller.ts";
import type { PersistentAskHandle } from "./ui/persistent-ask.ts";
import { waitForEditor } from "./ui/wait-for-editor.ts";

interface Waiter {
	cleanup: () => void;
	reject: (error: Error) => void;
	requestIds: Set<string>;
	resolve: (result: WaitForAnswersResult) => void;
}

/** Owns one active branch's forms. Answers are routed to either a wait or a transcript message. */
export class BackgroundAskRuntime {
	private context?: ExtensionContext;
	private generation = new AbortController();
	// Pi emits turn_start before persisting the custom message that wakes an idle agent.
	private readonly pendingIdleDelivery = new Set<string>();
	private readonly pi: ExtensionAPI;
	private pumping = false;
	private hidden = false;
	private panel?: PersistentAskHandle;
	private readonly draftSignatures = new Map<string, string>();
	private readonly remoteAsk?: RemoteAskRuntime;
	private requests: QueuedRequest[] = [];
	private readonly routed = new Set<string>();
	private readonly executionOwners = new Map<string, string | undefined>();
	private waiter?: Waiter;
	private endWaitingStatus?: () => void;
	private endQueueStatus?: () => void;
	private stopWaitingForEditor?: () => void;

	constructor(pi: ExtensionAPI, remoteAsk?: RemoteAskRuntime) {
		this.pi = pi;
		this.remoteAsk = remoteAsk;
	}

	/** Track actual execution ancestry, never deriving ownership from the call ID's spelling. */
	trackExecution(event: {
		toolCallId: string;
		parentToolCallId?: string;
	}): void {
		this.executionOwners.set(
			event.toolCallId,
			event.parentToolCallId
				? this.executionOwners.get(event.parentToolCallId)
				: event.toolCallId
		);
	}

	/** Release completed execution ancestry; queued requests already hold their root. */
	forgetExecution(toolCallId: string): void {
		this.executionOwners.delete(toolCallId);
	}

	/** Persist before returning. Background forms do not own the agent's abort signal. */
	enqueue(
		requestId: string,
		params: AskParams,
		ctx: ExtensionContext,
		presentSingleAsMulti: boolean,
		toolCallId?: string
	) {
		this.context ??= ctx;
		const parentToolCallId = toolCallId
			? this.executionOwners.get(toolCallId)
			: undefined;
		if (!this.requests.some((request) => request.requestId === requestId)) {
			this.pi.appendEntry(ASK_QUEUED_ENTRY, {
				version: 1,
				requestId,
				...(toolCallId ? { toolCallId } : {}),
				...(parentToolCallId ? { parentToolCallId } : {}),
				params,
				presentSingleAsMulti,
			});
			this.requests.push({
				requestId,
				toolCallId,
				parentToolCallId,
				params,
				presentSingleAsMulti,
				delivered: false,
			});
			this.waiter?.requestIds.add(requestId);
		}
		this.updateStatus();
		this.start();
		return {
			status: "queued" as const,
			requestId,
			questionIds: params.questions.map((question) => question.id),
			pendingRequests: this.pendingCount(),
		};
	}

	/** Verify routed claims against finalized transcript entries before the next model turn. */
	reconcileDelivery(ctx: ExtensionContext): void {
		const delivered = new Set(
			restoreQueuedRequests(ctx.sessionManager.getBranch())
				.filter((request) => request.delivered)
				.map((request) => request.requestId)
		);
		for (const request of this.requests) {
			request.delivered = delivered.has(request.requestId);
			if (request.delivered) {
				this.pendingIdleDelivery.delete(request.requestId);
			}
		}
		this.routed.clear();
	}

	/** Count unfinished forms, not previously completed answers. */
	pendingCount(): number {
		return this.requests.filter((request) => !request.completion).length;
	}

	/** No built-in timeout. Abort stops only this wait, never the queued forms. */
	wait(signal: AbortSignal | undefined): Promise<WaitForAnswersResult> {
		if (signal?.aborted) {
			return Promise.reject(waitInterrupted());
		}
		if (this.waiter) {
			return Promise.reject(
				new Error("Another wait_for_answers call is already waiting.")
			);
		}
		return new Promise((resolve, reject) => {
			const abort = () => {
				this.setWaitingStatus(false);
				this.waiter = undefined;
				signal?.removeEventListener("abort", abort);
				reject(waitInterrupted());
				this.deliverIdle();
			};
			this.waiter = {
				requestIds: new Set(
					this.requests
						.filter(
							(request) => !(request.completion && this.isRouted(request))
						)
						.map((request) => request.requestId)
				),
				resolve,
				reject,
				cleanup: () => signal?.removeEventListener("abort", abort),
			};
			signal?.addEventListener("abort", abort, { once: true });
			this.finishWait();
			if (this.waiter) {
				this.setWaitingStatus(true);
			}
		});
	}

	/** Hiding the UI releases only the wait, never its unanswered requests. */
	defer(reason: "hidden" | "user_message"): void {
		this.setHidden(true);
		if (!this.waiter) {
			return;
		}
		const current = this.waiter;
		this.waiter = undefined;
		current.cleanup();
		this.setWaitingStatus(false);
		const waiting = this.requests.filter((request) =>
			current.requestIds.has(request.requestId)
		);
		const results = waiting.flatMap((request) =>
			request.completion && !this.isRouted(request) ? [request.completion] : []
		);
		for (const result of results) {
			this.routed.add(result.requestId);
		}
		current.resolve({
			status: "deferred",
			reason,
			requestIds: [...current.requestIds],
			pendingRequestIds: waiting
				.filter((request) => !request.completion)
				.map((request) => request.requestId),
			results,
		});
	}

	/** Reopen the FIFO queue without replacing or clearing the ordinary editor. */
	open(ctx: ExtensionContext): void {
		this.context ??= ctx;
		if (!this.pendingCount()) {
			ctx.ui.notify("No pending questionnaires.", "info");
			return;
		}
		this.setHidden(false);
		this.panel?.focus();
		this.start();
	}

	onUserInput(): void {
		if (this.waiter) {
			this.defer("user_message");
		}
	}

	private setHidden(hidden: boolean): void {
		if (this.hidden === hidden) {
			return;
		}
		this.hidden = hidden;
		this.pi.appendEntry(ASK_QUEUE_UI_ENTRY, { hidden });
		this.panel?.setHidden(hidden);
		this.updateStatus();
	}

	private saveDraft(
		request: QueuedRequest,
		draft: AskDraft,
		signal: AbortSignal
	): void {
		if (
			signal.aborted ||
			request.completion ||
			draft.state.completed ||
			draft.state.cancelled
		) {
			return;
		}
		const signature = JSON.stringify(draft);
		if (this.draftSignatures.get(request.requestId) === signature) {
			return;
		}
		request.draft = draft;
		this.draftSignatures.set(request.requestId, signature);
		this.pi.appendEntry(ASK_DRAFT_ENTRY, {
			requestId: request.requestId,
			draft,
		});
	}

	private setWaitingStatus(active: boolean): void {
		if (active) {
			this.endWaitingStatus ??= beginUserWait(
				this.pi.events,
				"Waiting for user answers"
			);
			return;
		}
		this.endWaitingStatus?.();
		this.endWaitingStatus = undefined;
	}

	/** Stop explicit waiting without removing requests or aborting agent work. */
	interruptWait(error: Error): void {
		const waiter = this.waiter;
		if (!waiter) {
			return;
		}
		this.waiter = undefined;
		waiter.cleanup();
		this.setWaitingStatus(false);
		waiter.reject(error);
	}
	/** Rebuild from the current branch and invalidate every older surface and callback. */
	restore(ctx: ExtensionContext): void {
		this.dispose();
		this.generation = new AbortController();
		this.context = ctx;
		this.requests = restoreQueuedRequests(ctx.sessionManager.getBranch());
		this.hidden = restoreQueueHidden(ctx.sessionManager.getBranch());
		this.routed.clear();
		if (ctx.mode !== "tui") {
			return;
		}
		this.updateStatus();
		const signal = this.generation.signal;
		if (this.pendingCount()) {
			this.stopWaitingForEditor = waitForEditor(ctx, () => {
				this.stopWaitingForEditor = undefined;
				if (!signal.aborted) {
					this.start();
				}
			});
		}
		queueMicrotask(() => {
			if (!signal.aborted) {
				this.deliverIdle();
			}
		});
	}

	/** Idempotent lifecycle cleanup. Persisted requests remain available for recovery. */
	dispose(): void {
		this.stopWaitingForEditor?.();
		this.stopWaitingForEditor = undefined;
		this.generation.abort();
		this.endQueueStatus?.();
		this.endQueueStatus = undefined;
		this.pendingIdleDelivery.clear();
		this.executionOwners.clear();
		this.draftSignatures.clear();
		this.panel = undefined;
		if (this.waiter) {
			this.setWaitingStatus(false);
			this.waiter.cleanup();
			this.waiter.reject(waitInterrupted());
			this.waiter = undefined;
		}
		this.context = undefined;
		this.pumping = false;
	}

	/** Add ready answers at Pi's atomic turn boundary, never inside a tool call/result pair. */
	deliverBoundary(
		event: { entries: SessionBoundaryDraft[] },
		ctx: ExtensionContext
	): BoundaryResult | undefined {
		if (ctx.mode !== "tui") {
			return;
		}
		const answers = this.readyAnswers();
		if (!answers.length) {
			return;
		}
		for (const answer of answers) {
			this.routed.add(answer.requestId);
		}
		return {
			entries: [
				...event.entries,
				...answers.map((answer) => ({
					type: "custom_message" as const,
					...answerMessage(answer),
				})),
			],
			continue: answers.some((answer) => !answer.result?.cancelled),
		};
	}

	private isRouted(request: QueuedRequest): boolean {
		return (
			request.delivered ||
			this.routed.has(request.requestId) ||
			this.pendingIdleDelivery.has(request.requestId)
		);
	}

	private readyAnswers(): QueuedAnswer[] {
		return this.requests.flatMap((request) =>
			request.completion &&
			!this.isRouted(request) &&
			!this.waiter?.requestIds.has(request.requestId)
				? [request.completion]
				: []
		);
	}

	/** Wake only a fully settled agent; an active signal rules out transient idle reports. */
	deliverIdle(): void {
		if (!this.context?.isIdle() || this.context.signal) {
			return;
		}
		for (const answer of this.readyAnswers()) {
			this.pendingIdleDelivery.add(answer.requestId);
			const triggerTurn = !answer.result?.cancelled;
			this.pi.sendMessage(answerMessage(answer), { triggerTurn });
			// Cancellation is context only; the first answer starts a turn.
			if (triggerTurn) {
				break;
			}
		}
	}

	private updateStatus(): void {
		const pending = this.pendingCount();
		// Acquire only after mounting; keep the owner through FIFO panel handoffs.
		if (pending && !this.hidden && (this.panel || this.endQueueStatus)) {
			this.endQueueStatus ??= beginUserWait(
				this.pi.events,
				"Questions awaiting your response"
			);
		} else {
			this.endQueueStatus?.();
			this.endQueueStatus = undefined;
		}
		this.context?.ui.setStatus(
			"ask:queue",
			pending
				? `Questionnaires pending: ${pending}${this.hidden ? " · /ask-queue" : ""}`
				: undefined
		);
	}

	private finishWait(): void {
		if (!this.waiter) {
			return;
		}
		const waiting = this.requests.filter((request) =>
			this.waiter?.requestIds.has(request.requestId)
		);
		if (waiting.some((request) => !request.completion)) {
			return;
		}
		const current = this.waiter;
		this.waiter = undefined;
		current.cleanup();
		this.setWaitingStatus(false);
		const results = waiting.flatMap((request) =>
			request.completion && !this.isRouted(request) ? [request.completion] : []
		);
		for (const result of results) {
			this.routed.add(result.requestId);
		}
		current.resolve({
			status: "complete",
			requestIds: [...current.requestIds],
			results,
		});
	}

	private async completeForm(
		ctx: ExtensionContext,
		request: QueuedRequest,
		signal: AbortSignal
	): Promise<QueuedAnswer> {
		try {
			const result = await runAskFlow(ctx, request.params, {
				abortOnCancel: false,
				background: {
					hidden: this.hidden,
					draft: request.draft,
					onHandle: (handle) => {
						if (signal.aborted) {
							return;
						}
						this.panel = handle;
						this.updateStatus();
					},
					onHiddenChange: (hidden) => {
						if (!signal.aborted) {
							this.setHidden(hidden);
						}
					},
					onDefer: () => {
						if (!signal.aborted) {
							this.defer("hidden");
						}
					},
					onDraft: (draft) => this.saveDraft(request, draft, signal),
				},
				signal,
				presentSingleAsMulti: request.presentSingleAsMulti,
				herdrEvents: this.pi.events,
				remote: this.remoteAsk
					? {
							runtime: this.remoteAsk,
							source: "tool",
							toolCallId: request.toolCallId ?? request.requestId,
						}
					: undefined,
			});
			return { requestId: request.requestId, result };
		} catch (error) {
			return {
				requestId: request.requestId,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async pump(signal: AbortSignal): Promise<void> {
		if (this.pumping || !this.context || this.context.mode !== "tui") {
			return;
		}
		this.pumping = true;
		const ctx = this.context;
		try {
			while (!signal.aborted) {
				const request = this.requests.find((item) => !item.completion);
				if (!request) {
					break;
				}
				const completion = {
					...(await this.completeForm(ctx, request, signal)),
					...(request.parentToolCallId
						? { parentToolCallId: request.parentToolCallId }
						: {}),
				};
				if (signal.aborted) {
					return;
				}
				appendAskHistoryCompletion(this.pi, completion);
				// The existing completion journal owns the visible card, not the consumption path.
				this.pi.appendEntry(ASK_COMPLETED_ENTRY, {
					...completion,
					display: true,
				});
				request.completion = completion;
				request.draft = undefined;
				this.draftSignatures.delete(request.requestId);
				this.updateStatus();
				this.finishWait();
				this.deliverIdle();
			}
		} finally {
			if (signal === this.generation.signal) {
				this.pumping = false;
			}
		}
	}

	private start(): void {
		if (this.stopWaitingForEditor) {
			return;
		}
		const signal = this.generation.signal;
		queueMicrotask(() => {
			if (signal.aborted) {
				return;
			}
			this.pump(signal).catch((error) => {
				if (!signal.aborted) {
					this.context?.ui.notify(
						`Question queue failed: ${String(error)}`,
						"error"
					);
				}
			});
		});
	}
}

/** Register branch recovery and boundary delivery for one extension runtime. */
export function createBackgroundAskRuntime(
	pi: ExtensionAPI,
	remoteAsk?: RemoteAskRuntime
): BackgroundAskRuntime {
	const runtime = new BackgroundAskRuntime(pi, remoteAsk);
	pi.on("tool_execution_start", (event) => runtime.trackExecution(event));
	pi.on("tool_execution_end", (event) =>
		runtime.forgetExecution(event.toolCallId)
	);
	// Wait for all session_start handlers, including Herdr's status consumer.
	pi.on("resources_discover", (_event, ctx) => runtime.restore(ctx));
	pi.on("session_tree", (_event, ctx) => runtime.restore(ctx));
	pi.on("session_shutdown", () => runtime.dispose());
	pi.on("input", (event) => {
		if (event.source === "interactive") {
			runtime.onUserInput();
		}
	});
	pi.registerCommand("ask-queue", {
		description: "Reopen pending questions without replacing normal input",
		handler: async (_args, ctx) => runtime.open(ctx),
	});
	pi.registerCommand("ask-defer", {
		description:
			"Defer all questions and release the current wait without cancelling requests",
		handler: async () => runtime.defer("hidden"),
	});
	pi.on("agent_settled", () => runtime.deliverIdle());
	pi.on("turn_start", (_event, ctx) => runtime.reconcileDelivery(ctx));
	pi.on("turn_end", (event, ctx) => runtime.deliverBoundary(event, ctx));
	pi.on("agent_before_settle", (event, ctx) =>
		runtime.deliverBoundary(event, ctx)
	);
	return runtime;
}

function waitInterrupted(): DOMException {
	return new DOMException("Question wait interrupted", "AbortError");
}

function answerMessage(answer: QueuedAnswer) {
	const images = answer.result ? imageContent(answer.result) : [];
	return {
		customType: ASK_ANSWER_MESSAGE,
		content: images.length
			? [{ type: "text" as const, text: formatQueuedAnswer(answer) }, ...images]
			: formatQueuedAnswer(answer),
		display: false,
		details: answer,
	};
}
