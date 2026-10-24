import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	appendAskHistoryCompletion,
	appendAskHistoryRequest,
} from "./ask-history.ts";
import { appendAskPayload } from "./ask-payload-store.ts";
import {
	ASK_BACKGROUND_ONLY_TOOL_DESCRIPTION,
	ASK_TOOL_DESCRIPTION,
	invalidPayloadResponse,
	nonInteractiveResponse,
	renderAskToolCall,
	renderAskToolResult,
	successfulResponse,
	validateParams,
} from "./ask-tool-helpers.ts";
import type { BackgroundAskRuntime } from "./background-ask.ts";
import { AskQueuedSchema } from "./background-ask-state.ts";
import { getAskConfigStore } from "./config/store.ts";
import { resolveContextFiles } from "./context-files.ts";
import { connectExternalAskUi, runExternalAskFlow } from "./external-ui.ts";
import type { RemoteAskRuntime } from "./remote-ask.ts";
import { AskOutputSchema, toAskOutput } from "./result-schema.ts";
import { AskBackgroundOnlyParamsSchema, AskParamsSchema } from "./schema.ts";
import { prepareAskParams } from "./state/normalize.ts";
import type { AskParams, AskState } from "./types.ts";
import { runAskFlow } from "./ui/controller.ts";

export function registerAskTool(
	pi: ExtensionAPI,
	remoteAsk?: RemoteAskRuntime,
	backgroundAsk?: BackgroundAskRuntime,
	isBackgroundOnly: () => boolean = () => false
) {
	const backgroundOnly = isBackgroundOnly();
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: backgroundOnly
			? ASK_BACKGROUND_ONLY_TOOL_DESCRIPTION
			: ASK_TOOL_DESCRIPTION,
		promptSnippet:
			"Ask the user for what you cannot find yourself: missing facts, preferences, decisions",
		parameters: backgroundOnly
			? AskBackgroundOnlyParamsSchema
			: AskParamsSchema,
		outputSchema: Type.Union([AskOutputSchema, AskQueuedSchema]),
		prepareArguments: (args) => prepareAskParams(args) as AskParams,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			executeAskTool(
				pi,
				toolCallId,
				params as AskParams,
				signal,
				onUpdate,
				ctx,
				remoteAsk,
				backgroundAsk,
				isBackgroundOnly
			),
		renderCall: renderAskToolCall,
		renderResult: renderAskToolResult,
	});
}

async function executeNonTuiAsk(
	pi: Pick<ExtensionAPI, "events">,
	ctx: ExtensionContext,
	params: AskParams,
	state: AskState,
	toolCallId: string,
	signal: AbortSignal | undefined,
	runtime?: RemoteAskRuntime
) {
	const provider =
		!params.background && runtime
			? connectExternalAskUi(pi.events, ctx.mode, toolCallId)
			: undefined;
	if (!(provider && runtime)) {
		return nonInteractiveResponse(state);
	}
	const result = await runExternalAskFlow({
		provider,
		runtime,
		state,
		toolCallId,
		signal,
	});
	if (result.cancelled) {
		ctx.abort();
	}
	return successfulResponse(result);
}
async function executeAskTool(
	pi: Pick<ExtensionAPI, "appendEntry" | "events">,
	toolCallId: string,
	input: AskParams,
	signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: ExtensionContext,
	remoteAsk?: RemoteAskRuntime,
	backgroundAsk?: BackgroundAskRuntime,
	isBackgroundOnly: () => boolean = () => false
) {
	const resolved = await resolveContextFiles(input);
	if (!resolved.ok) {
		return invalidPayloadResponse(input, resolved.issues);
	}
	const config = await getAskConfigStore().getConfig();
	const backgroundOnly = isBackgroundOnly();
	const params = backgroundOnly
		? { ...resolved.params, background: true }
		: resolved.params;
	const validation = validateParams(params, {
		presentSingleAsMulti: config.behaviour.presentSingleAsMulti,
	});
	if (!validation.ok) {
		return invalidPayloadResponse(params, validation.issues);
	}
	appendAskPayload(pi, {
		params,
		source: "tool",
		sourceEntryId: toolCallId,
	});
	const requestId = appendAskHistoryRequest(
		pi,
		toolCallId,
		validation.state,
		Boolean(params.background)
	);
	try {
		return await executeRecordedAsk(
			pi,
			requestId,
			toolCallId,
			params,
			validation.state,
			signal,
			ctx,
			remoteAsk,
			backgroundAsk,
			backgroundOnly
		);
	} catch (error) {
		appendAskHistoryCompletion(pi, {
			requestId,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

async function executeRecordedAsk(
	pi: Pick<ExtensionAPI, "appendEntry" | "events">,
	requestId: string,
	toolCallId: string,
	params: AskParams,
	state: AskState,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
	remoteAsk?: RemoteAskRuntime,
	backgroundAsk?: BackgroundAskRuntime,
	backgroundOnly = false
) {
	if (ctx.mode !== "tui") {
		const response = await executeNonTuiAsk(
			pi,
			ctx,
			params,
			state,
			toolCallId,
			signal,
			remoteAsk
		);
		return recordResponse(pi, requestId, response);
	}
	if (params.background) {
		if (!backgroundAsk) {
			throw new Error("Background question queue is unavailable.");
		}
		const receipt = backgroundAsk.enqueue(
			requestId,
			params,
			ctx,
			Boolean(
				state.questions.some((question) => question.presentedType === "multi")
			),
			toolCallId
		);
		return {
			content: [
				{
					type: "text" as const,
					text: `Queued ask_user [${receipt.requestId}]. ${receipt.pendingRequests} form(s) pending. This is not an answer. The answer arrives later as a background-answer message${backgroundOnly ? "" : " or from wait_for_answers"}.`,
				},
			],
			details: receipt,
			structuredContent: receipt,
		};
	}
	ctx.ui.setWorkingVisible(false);
	try {
		const result = await runAskFlow(ctx, params, {
			signal,
			remote: remoteAsk
				? { runtime: remoteAsk, source: "tool", toolCallId }
				: undefined,
			herdrEvents: pi.events,
		});
		return recordResponse(pi, requestId, successfulResponse(result));
	} finally {
		ctx.ui.setWorkingVisible(true);
	}
}

function recordResponse(
	pi: Pick<ExtensionAPI, "appendEntry">,
	requestId: string,
	response:
		| ReturnType<typeof successfulResponse>
		| ReturnType<typeof invalidPayloadResponse>
		| ReturnType<typeof nonInteractiveResponse>
) {
	const result = { ...response.details, requestId };
	appendAskHistoryCompletion(pi, { requestId, result });
	return {
		...response,
		content: response.content.map((item, index) =>
			item.type === "text" && index === 0
				? {
						...item,
						text: `ask_user [${requestId}]\n${item.text}`,
					}
				: item
		),
		details: result,
		structuredContent: toAskOutput(result),
	};
}
