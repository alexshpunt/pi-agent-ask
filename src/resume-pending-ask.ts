import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import {
	appendAskHistoryCompletion,
	findPendingHistoryRequest,
} from "./ask-history.ts";
import { reserveRecoverySurfaces } from "./ask-recovery-order.ts";
import type { AskSurfaceReservation } from "./ask-surface.ts";
import { successfulResponse } from "./ask-tool-helpers.ts";
import type { BackgroundAskRuntime } from "./background-ask.ts";
import {
	appendPendingAskDismissal,
	findPendingAskToolCall,
	type PendingAskToolCall,
} from "./pending-ask.ts";
import type { RemoteAskRuntime } from "./remote-ask.ts";
import { runAskFlow } from "./ui/controller.ts";

const REOPEN_REASONS: ReadonlySet<SessionStartEvent["reason"]> = new Set([
	"startup",
	"resume",
	"fork",
]);
const DISMISS_NOTICE = "Unanswered ask_user form dismissed.";

export function registerPendingAskResume(
	pi: ExtensionAPI,
	remoteAsk: RemoteAskRuntime,
	backgroundAsk?: BackgroundAskRuntime
): void {
	let generation = new AbortController();
	let pendingAsk: PendingAskToolCall | undefined;
	let foreground: AskSurfaceReservation | undefined;
	const invalidate = () => {
		generation.abort();
		foreground?.cancel();
		foreground = undefined;
		generation = new AbortController();
		pendingAsk = undefined;
	};

	pi.on("session_start", (event, ctx) => {
		invalidate();
		if (ctx.mode === "tui" && REOPEN_REASONS.has(event.reason)) {
			pendingAsk = findPendingAskToolCall(ctx);
		}
	});
	pi.on("resources_discover", (_event, ctx) => {
		const pending = pendingAsk;
		pendingAsk = undefined;
		if (ctx.mode !== "tui") {
			backgroundAsk?.restore(ctx);
			return;
		}
		const surfaces = reserveRecoverySurfaces(
			ctx.sessionManager.getBranch(),
			pending
		);
		foreground = surfaces.foreground;
		backgroundAsk?.restore(ctx, surfaces.background);
		if (!backgroundAsk) {
			for (const surface of surfaces.background.values()) {
				surface.cancel();
			}
		}
		if (!pending) {
			return;
		}
		const signal = generation.signal;
		const surface = surfaces.foreground;
		queueMicrotask(() => {
			if (signal.aborted) {
				surface?.cancel();
				return;
			}
			reopenPendingAsk(pi, ctx, pending, remoteAsk, signal, surface)
				.catch((error: unknown) => {
					if (!signal.aborted) {
						ctx.ui.notify(
							`Could not reopen unanswered ask_user form: ${formatError(error)}`,
							"error"
						);
					}
				})
				.finally(() => surface?.cancel());
		});
	});
	pi.on("session_tree", (_event, ctx) => {
		invalidate();
		backgroundAsk?.restore(ctx);
	});
	pi.on("session_shutdown", invalidate);
}

async function reopenPendingAsk(
	pi: Pick<ExtensionAPI, "appendEntry" | "events" | "sendUserMessage">,
	ctx: ExtensionContext,
	pendingAsk: PendingAskToolCall,
	remoteAsk: RemoteAskRuntime,
	signal: AbortSignal,
	surface?: AskSurfaceReservation
): Promise<void> {
	ctx.ui.notify(
		`Reopening unanswered ask_user form: ${pendingAsk.params.questions.length} question(s).`,
		"info"
	);
	const result = await runAskFlow(ctx, pendingAsk.params, {
		remote: {
			runtime: remoteAsk,
			source: "ask:resume",
			toolCallId: pendingAsk.toolCallId,
		},
		herdrEvents: pi.events,
		signal,
		surface,
	});
	if (signal.aborted) {
		return;
	}

	const requestId = findPendingHistoryRequest(
		ctx.sessionManager.getBranch(),
		pendingAsk.toolCallId
	);
	if (requestId) {
		appendAskHistoryCompletion(pi, {
			requestId,
			result: { ...result, requestId },
		});
	}
	appendPendingAskDismissal(pi, pendingAsk.toolCallId);
	if (result.cancelled) {
		ctx.ui.notify(DISMISS_NOTICE, "info");
		return;
	}

	const content = successfulResponse(result).content;
	pi.sendUserMessage(
		content.length === 1 ? content[0].text : content,
		ctx.isIdle() ? undefined : { deliverAs: "followUp" }
	);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
