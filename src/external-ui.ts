import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { withAskSurface } from "./ask-surface.ts";
import {
	applyRemoteAskResponse,
	parseRemoteResponse,
	type RemoteAskFlowHandle,
	type RemoteAskRuntime,
	type RemoteAskSubmitResolution,
} from "./remote-ask.ts";
import { toAskResult } from "./state/result.ts";
import type { AskQuestion, AskResult, AskState } from "./types.ts";

/** Synchronous, per-call negotiation with a trusted extension in this Pi process. */
export const PI_ASK_EXTERNAL_UI_EVENT = "pi-agent-ask:external-ui";

/** A normalized foreground form. File previews have been loaded; paths are omitted. */
export interface ExternalAskRequest {
	flowId: string;
	questions: AskQuestion[];
	/** Aborted on every terminal path. The provider must close its form and transport. */
	signal: AbortSignal;
	title?: string;
	toolCallId: string;
	version: 1;
}

/** A bridge offers this only after verifying that its UI is connected and supported. */
export interface ExternalAskProvider {
	id: string;
	/** Wait for an explicit answer/cancel; rejection is a UI failure, not cancellation. */
	open(request: ExternalAskRequest): Promise<unknown>;
	version: 1;
}

/** First supported provider wins. Late or unsupported connections return false. */
export interface ExternalAskConnection {
	connect(provider: ExternalAskProvider): boolean;
	mode: ExtensionContext["mode"];
	toolCallId: string;
	version: 1;
}

/** Negotiate before opening a non-TUI foreground form; never replaces the native TUI. */
export function connectExternalAskUi(
	events: Pick<ExtensionAPI["events"], "emit">,
	mode: ExtensionContext["mode"],
	toolCallId: string
): ExternalAskProvider | undefined {
	if (mode === "tui") {
		return;
	}
	let provider: ExternalAskProvider | undefined;
	let accepting = true;
	const request: ExternalAskConnection = {
		version: 1,
		mode,
		toolCallId,
		connect(candidate) {
			if (!accepting || provider || !isSupportedProvider(candidate)) {
				return false;
			}
			provider = candidate;
			return true;
		},
	};
	try {
		events.emit(PI_ASK_EXTERNAL_UI_EVENT, request);
	} finally {
		accepting = false;
	}
	return provider;
}

function isSupportedProvider(value: unknown): value is ExternalAskProvider {
	if (!value || typeof value !== "object") {
		return false;
	}
	const provider = value as Partial<ExternalAskProvider>;
	return (
		provider.version === 1 &&
		typeof provider.id === "string" &&
		provider.id.trim().length > 0 &&
		typeof provider.open === "function"
	);
}

function externalRequest(
	input: ExternalAskFlow,
	flowId: string,
	signal: AbortSignal
): ExternalAskRequest {
	return {
		version: 1,
		flowId,
		toolCallId: input.toolCallId,
		title: input.state.title,
		questions: input.state.questions.map((question) => ({
			...question,
			options: question.options.map(
				({ previewFile: _path, ...option }) => option
			),
		})),
		signal,
	};
}
interface ExternalAskFlow {
	provider: ExternalAskProvider;
	runtime: RemoteAskRuntime;
	signal?: AbortSignal;
	state: AskState;
	toolCallId: string;
}

/** Wait once, validate with the shared remote-answer rules, and release the UI on exit. */
export function runExternalAskFlow(input: ExternalAskFlow): Promise<AskResult> {
	return withAskSurface(input.signal, () => waitForExternalAnswer(input));
}

async function waitForExternalAnswer(
	input: ExternalAskFlow
): Promise<AskResult> {
	const controller = new AbortController();
	let flow: RemoteAskFlowHandle | undefined;
	let settled = false;
	let resolveResult: ((result: AskResult) => void) | undefined;
	let rejectResult: ((error: unknown) => void) | undefined;
	const pending = new Promise<AskResult>((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});
	const finish = (result: AskResult) => {
		if (settled) {
			return;
		}
		settled = true;
		flow?.complete(result);
		resolveResult?.(result);
	};
	const submit = (data: unknown): RemoteAskSubmitResolution => {
		if (settled) {
			return {
				ok: false,
				error: "flow_not_found",
				message: "Ask flow is not active.",
			};
		}
		const parsed = parseRemoteResponse(data);
		if (!parsed.ok) {
			return { ok: false, error: "invalid_answer", message: parsed.message };
		}
		const applied = applyRemoteAskResponse(input.state, parsed.response);
		if (applied.ok) {
			finish(toAskResult(applied.state));
		}
		return applied;
	};
	const fail = (error: unknown) => {
		if (!settled) {
			settled = true;
			rejectResult?.(error);
		}
	};
	const abort = () => finish({ ...toAskResult(input.state), cancelled: true });
	input.signal?.addEventListener("abort", abort, { once: true });
	try {
		if (input.signal?.aborted) {
			abort();
		} else {
			flow = input.runtime.startFlow({
				source: "tool",
				toolCallId: input.toolCallId,
				title: input.state.title,
				questions: input.state.questions,
				onSubmit: submit,
			});
			const request = externalRequest(input, flow.flowId, controller.signal);
			Promise.resolve()
				.then(() => {
					if (!settled) {
						return input.provider.open(request);
					}
				})
				.then((response) => {
					if (!settled) {
						const result = submit(response);
						if (!result.ok) {
							fail(
								new Error(
									`External ask UI returned an invalid response: ${result.message}`
								)
							);
						}
					}
				})
				.catch(fail);
		}
		return await pending;
	} finally {
		input.signal?.removeEventListener("abort", abort);
		flow?.dispose();
		controller.abort();
	}
}
