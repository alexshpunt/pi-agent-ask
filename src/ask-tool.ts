import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendAskPayload } from "./ask-payload-store.ts";
import {
	ASK_TOOL_DESCRIPTION,
	ASK_TOOL_PROMPT_GUIDELINES,
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
import { connectExternalAskUi, runExternalAskFlow } from "./external-ui.ts";
import { resolvePreviewFiles } from "./preview-files.ts";
import type { RemoteAskRuntime } from "./remote-ask.ts";
import { AskResultSchema } from "./result-schema.ts";
import { AskParamsSchema } from "./schema.ts";
import { prepareAskParams } from "./state/normalize.ts";
import type { AskParams, AskState } from "./types.ts";
import { runAskFlow } from "./ui/controller.ts";

export function registerAskTool(
	pi: ExtensionAPI,
	remoteAsk?: RemoteAskRuntime,
	backgroundAsk?: BackgroundAskRuntime
) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: ASK_TOOL_DESCRIPTION,
		promptSnippet:
			"Clarify ambiguous or preference-sensitive decisions with a short interactive interview before proceeding",
		promptGuidelines: [...ASK_TOOL_PROMPT_GUIDELINES],
		parameters: AskParamsSchema,
		outputSchema: Type.Union([AskResultSchema, AskQueuedSchema]),
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
				backgroundAsk
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
	backgroundAsk?: BackgroundAskRuntime
) {
	const resolved = await resolvePreviewFiles(input, ctx.cwd);
	if (!resolved.ok) {
		return invalidPayloadResponse(input, resolved.issues);
	}
	const params = resolved.params;
	const config = await getAskConfigStore().getConfig();
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
	if (ctx.mode !== "tui") {
		return executeNonTuiAsk(
			pi,
			ctx,
			params,
			validation.state,
			toolCallId,
			signal,
			remoteAsk
		);
	}
	if (params.background) {
		if (!backgroundAsk) {
			throw new Error("Background question queue is unavailable.");
		}
		const receipt = backgroundAsk.enqueue(
			toolCallId,
			params,
			ctx,
			config.behaviour.presentSingleAsMulti
		);
		return {
			content: [
				{
					type: "text" as const,
					text: `Queued ask_user [${receipt.requestId}]. ${receipt.pendingRequests} form(s) pending. This is not an answer. Continue independent work; call wait_for_answers when answers are needed.`,
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
		return successfulResponse(result);
	} finally {
		ctx.ui.setWorkingVisible(true);
	}
}
