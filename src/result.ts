import {
	CANCELLED_RESULT_TEXT,
	SUBMITTED_RESULT_TEXT,
} from "./constants/text.ts";
import { formatResultLines } from "./result-format.ts";
import type { AskResult } from "./types.ts";

export function renderResultText(result: AskResult): string {
	if (result.error) {
		return "Invalid tool payload";
	}
	if (result.cancelled) {
		return result.comment
			? `${CANCELLED_RESULT_TEXT}\nComment: ${result.comment}`
			: CANCELLED_RESULT_TEXT;
	}
	const lines = formatResultLines(result, { mode: "render" });
	if (result.comment) {
		lines.push(`Comment: ${result.comment}`);
	}
	return lines.join("\n") || SUBMITTED_RESULT_TEXT;
}
