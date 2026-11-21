import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	appendAskHistoryCompletion,
	appendAskHistoryRequest,
} from "./ask-history.ts";
import { prepareAsk, presentsSingleAsMulti } from "./ask-tool.ts";
import type { BackgroundAskRuntime } from "./background-ask.ts";
import { prepareAskParams } from "./state/normalize.ts";
import type { AskParams, AskResult, AskValidationIssue } from "./types.ts";

/** Synchronous request from a trusted extension to queue a background form. */
export const PI_ASK_ENQUEUE_EVENT = "pi-agent-ask:enqueue";
/** Emitted when any background form completes, before its answer reaches the agent. */
export const PI_ASK_ANSWERED_EVENT = "pi-agent-ask:answered";

/** Same as `ask_user` input; the form is always queued in the background. */
export type ExtensionAskParams = Omit<AskParams, "background">;

export type ExtensionAskReceipt =
	| {
			pendingRequests: number;
			questionIds: string[];
			requestId: string;
			status: "queued";
	  }
	| { issues: AskValidationIssue[]; status: "invalid" }
	| { message: string; status: "unavailable" };

export interface ExtensionAskRequest {
	/** Context of the calling tool; its mode decides whether a form can open. */
	ctx: ExtensionContext;
	/** Identifies the requesting extension in the answered event and the queue journal. */
	owner: string;
	params: ExtensionAskParams;
	/** The first listener that accepts the request returns true; later calls return false. */
	respond(receipt: Promise<ExtensionAskReceipt>): boolean;
	/** The calling tool call; the answer card is linked to its execution. */
	toolCallId: string;
	version: 1;
}

export interface ExtensionAskAnsweredEvent {
	/** Owner only: deliver the answer as context for the agent's next turn without starting or extending one. */
	deliverQuietly(): void;
	error?: string;
	owner?: string;
	requestId: string;
	result?: AskResult;
	toolCallId?: string;
	version: 1;
}

/** Queue a form for another extension; resolves to undefined when pi-agent-ask is not loaded. */
export function requestExtensionAsk(
	events: Pick<ExtensionAPI["events"], "emit">,
	request: Omit<ExtensionAskRequest, "respond" | "version">
): Promise<ExtensionAskReceipt> | undefined {
	let receipt: Promise<ExtensionAskReceipt> | undefined;
	events.emit(PI_ASK_ENQUEUE_EVENT, {
		...request,
		version: 1,
		respond(candidate) {
			if (receipt) {
				return false;
			}
			receipt = candidate;
			return true;
		},
	} satisfies ExtensionAskRequest);
	return receipt;
}

/** Accept enqueue requests from other extensions in this Pi process. */
export function registerExtensionAsk(
	pi: Pick<ExtensionAPI, "appendEntry" | "events">,
	backgroundAsk: BackgroundAskRuntime
): void {
	pi.events.on(PI_ASK_ENQUEUE_EVENT, (data) => {
		const request = data as Partial<ExtensionAskRequest>;
		if (
			request?.version !== 1 ||
			typeof request.respond !== "function" ||
			!request.ctx ||
			typeof request.owner !== "string" ||
			!request.owner ||
			typeof request.toolCallId !== "string"
		) {
			return;
		}
		request.respond(
			enqueueExtensionAsk(pi, backgroundAsk, request as ExtensionAskRequest)
		);
	});
}

async function enqueueExtensionAsk(
	pi: Pick<ExtensionAPI, "appendEntry">,
	backgroundAsk: BackgroundAskRuntime,
	request: ExtensionAskRequest
): Promise<ExtensionAskReceipt> {
	if (request.ctx.mode !== "tui") {
		return {
			status: "unavailable",
			message: "Background questions require interactive TUI mode.",
		};
	}
	const validation = await prepareAsk(
		prepareAskParams(request.params) as AskParams,
		() => true
	);
	if (!validation.ok) {
		return { status: "invalid", issues: validation.issues };
	}
	const requestId = appendAskHistoryRequest(
		pi,
		request.toolCallId,
		validation.state,
		true
	);
	try {
		return backgroundAsk.enqueue(
			requestId,
			validation.params,
			request.ctx,
			presentsSingleAsMulti(validation.state),
			request.toolCallId,
			request.owner
		);
	} catch (error) {
		appendAskHistoryCompletion(pi, {
			requestId,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
