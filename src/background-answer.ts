import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { successfulResponse } from "./ask-tool-helpers.ts";
import {
	ASK_ANSWER_MESSAGE,
	type QueuedAnswer,
} from "./background-ask-state.ts";
import { renderResultText } from "./result.ts";
import { formatResultLines } from "./result-format.ts";

/** Keep background answers understandable without the original tool call in context. */
export function formatQueuedAnswer(answer: QueuedAnswer): string {
	const result = answer.result;
	const header = `Background answer [${answer.requestId}]${result?.title ? ` — ${result.title}` : ""}:`;
	if (!result) {
		return `${header}\nQuestion form failed: ${answer.error}`;
	}
	const questions = result.questions.map(
		(question) => `- [${question.id}] ${question.label}: ${question.prompt}`
	);
	const summary = successfulResponse({
		...result,
		questions: result.questions.map((question) => ({
			...question,
			label: `${question.label} [${question.id}]`,
		})),
	}).content[0].text;
	return `${header}\nQuestions:\n${questions.join("\n")}\nResponse:\n${summary}`;
}

/** Render the user-facing card without transport names or correlation IDs. */
export function renderBackgroundAnswer(
	answer: QueuedAnswer,
	theme: Pick<Theme, "fg" | "bg" | "bold">,
	outputPad: number
): Box {
	const status = answerStatus(answer);
	const title = answer.result?.title;
	const header =
		theme.fg(status.color, theme.bold(status.text)) +
		(title ? theme.fg("muted", ` · ${title}`) : "");
	const box = new Box(outputPad, 1, (text) =>
		theme.bg("customMessageBg", text)
	);
	box.addChild(
		new Text([header, ...answerBody(answer, theme)].join("\n"), 0, 0)
	);
	return box;
}

function answerStatus(answer: QueuedAnswer): {
	color: "error" | "warning" | "success";
	text: string;
} {
	if (!answer.result || answer.result.error) {
		return { color: "error", text: "! Question form failed" };
	}
	if (answer.result.cancelled) {
		return { color: "warning", text: "? Questions cancelled" };
	}
	if (answer.result.mode === "elaborate") {
		return { color: "warning", text: "? Clarification requested" };
	}
	return { color: "success", text: "✓ Answers received" };
}

function answerBody(
	answer: QueuedAnswer,
	theme: Pick<Theme, "fg" | "bold">
): string[] {
	const result = answer.result;
	if (!result) {
		return [theme.fg("error", answer.error ?? "No form result available.")];
	}
	if (result.error) {
		return [theme.fg("error", successfulResponse(result).content[0].text)];
	}
	if (result.cancelled) {
		return [theme.fg("muted", "No approval given.")];
	}
	if (result.mode === "elaborate") {
		return ["", theme.fg("toolOutput", renderResultText(result))];
	}
	return result.questions.flatMap((question) => [
		"",
		theme.bold(question.prompt),
		...formatResultLines(
			{ ...result, questions: [{ ...question, label: "Answer" }] },
			{ mode: "summary" }
		).map((line) => theme.fg("toolOutput", `  ${line}`)),
	]);
}

/** Give asynchronous answer messages their own transcript renderer. */
export function registerBackgroundAnswerRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<QueuedAnswer>(
		ASK_ANSWER_MESSAGE,
		(message, { outputPad }, theme) =>
			message.details
				? renderBackgroundAnswer(message.details, theme, outputPad)
				: undefined
	);
}
