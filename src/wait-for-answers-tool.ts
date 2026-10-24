import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatQueuedAnswer } from "./background-answer.ts";
import type { BackgroundAskRuntime } from "./background-ask.ts";
import {
	type WaitForAnswersResult,
	WaitForAnswersSchema,
} from "./background-ask-state.ts";
import { imageContent } from "./images.ts";

/** Register the explicit wait gate. Completed answers use this result instead of duplicate messages. */
export function registerWaitForAnswersTool(
	pi: ExtensionAPI,
	queue: BackgroundAskRuntime,
	isBackgroundOnly: () => boolean = () => false
): void {
	pi.registerTool({
		name: "wait_for_answers",
		exposure: isBackgroundOnly() ? "hidden" : "model-only",
		label: "Wait for Answers",
		description:
			"Use wait_for_answers when background questions are still unanswered and you cannot continue the task without their answers. It returns the answers once all are submitted, or returns early as deferred when the user hides the questions or sends a message.",
		promptSnippet: "Wait for pending background answers",
		parameters: Type.Object({}),
		outputSchema: WaitForAnswersSchema,
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			if (isBackgroundOnly()) {
				throw new Error(
					"wait_for_answers is unavailable in background-only mode. End your turn and receive answers asynchronously."
				);
			}
			if (ctx.mode !== "tui") {
				throw new Error("wait_for_answers requires interactive TUI mode.");
			}
			const result = await queue.wait(signal);
			return {
				content: [
					{ type: "text", text: formatWaitResult(result) },
					...result.results.flatMap((answer) =>
						answer.result ? imageContent(answer.result) : []
					),
				],
				details: result,
				structuredContent: result,
			};
		},
		renderCall: (_args, theme) =>
			new Text(theme.fg("toolTitle", theme.bold("wait_for_answers")), 0, 0),
		renderResult: (result) => {
			const details = result.details as WaitForAnswersResult | undefined;
			if (details?.status === "complete") {
				return new Text(
					`Consumed ${details.results.length} background answer(s).${details.results.length ? " Cards remain at the original calls." : ""}`,
					0,
					0
				);
			}
			if (details?.status === "deferred") {
				return new Text(
					`Questions deferred. ${details.pendingRequestIds.length} questionnaire(s) remain in /ask-queue.`,
					0,
					0
				);
			}
			return new Text(
				result.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
				0,
				0
			);
		},
	});
}

function formatWaitResult(result: WaitForAnswersResult): string {
	if (result.status === "deferred") {
		const pending = result.pendingRequestIds ?? [];
		const summary = `Answer wait released (${result.reason}). ${pending.length} questionnaire(s) remain pending: ${pending.join(", ") || "none"}. Pending questions are unanswered, not cancelled or approved. Do not repeat the wait automatically.`;
		return [summary, ...result.results.map(formatQueuedAnswer)].join("\n\n");
	}
	return result.results.length
		? result.results.map(formatQueuedAnswer).join("\n\n")
		: "No outstanding background answers. Previously delivered answers are already in context.";
}
