import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HistoryRecord } from "./ask-history-schema.ts";
import type { AskOption, AskResultAnswer } from "./types.ts";

/** Write a fresh Markdown snapshot. Existing files, including symlinks, are never replaced. */
export async function exportAskHistory(
	path: string,
	cwd: string,
	records: readonly HistoryRecord[]
) {
	if (!path.trim()) {
		throw new Error("An export path is required.");
	}
	const savedPath = resolve(cwd, path);
	const content = `${["# Ask history", ...records.map(renderRecord)].join("\n\n")}\n`;
	await writeFile(savedPath, content, {
		encoding: "utf8",
		flag: "wx",
		mode: 0o600,
	});
	return {
		path: savedPath,
		keys: records.map(({ requestId, questionId }) => ({
			requestId,
			questionId,
		})),
	};
}

function literal(text: string): string {
	const runs = text.match(/`+/g) ?? [];
	const fence = "`".repeat(
		runs.reduce((length, run) => Math.max(length, run.length + 1), 3)
	);
	return `${fence}text\n${text}\n${fence}`;
}
function field(label: string, text: string | undefined): string {
	return text === undefined ? "" : `### ${label}\n\n${literal(text)}`;
}
function renderRecord(record: HistoryRecord, index: number): string {
	const { question } = record;
	return [
		`## Question ${index + 1}`,
		`Status: ${record.status}\n\nMode: ${record.mode ?? "pending"}\n\nCreated: ${record.createdAt}\n\nBackground: ${record.background}`,
		field("Request key", record.requestId),
		field("Question key", record.questionId),
		field("Form title", record.title),
		field("Label", question.label),
		field("Question", question.prompt),
		`Type: ${question.type}\n\nPresented type: ${question.presentedType ?? question.type}`,
		...question.options.map(renderOption),
		...(record.answer ? renderAnswer(record.answer) : ["No committed answer."]),
		...(record.elaboration ?? []).map((item) =>
			[
				`### Clarification (${item.target.kind})`,
				...("selected" in item
					? [
							field("Noted option value", item.target.optionValue),
							`Selected: ${item.selected}`,
						]
					: []),
				field("Clarification note", item.note),
			].join("\n\n")
		),
		field("Error", record.error),
	]
		.filter(Boolean)
		.join("\n\n");
}
function renderOption(option: AskOption, index: number): string {
	return [
		`### Option ${index + 1}`,
		field("Value", option.value),
		field("Label", option.label),
		field("Description", option.description),
		field("Preview", option.preview),
		...(option.recommended === undefined
			? []
			: [`Recommended: ${option.recommended}`]),
	]
		.filter(Boolean)
		.join("\n\n");
}
function renderAnswer(answer: AskResultAnswer): string[] {
	return [
		`### Answer\n\nSelected positions: ${JSON.stringify(answer.indices)}`,
		...answer.values.map((value, index) =>
			field(`Selected value ${index + 1}`, value)
		),
		...answer.labels.map((label, index) =>
			field(`Selected label ${index + 1}`, label)
		),
		field("Custom answer", answer.customText),
		field("Question note", answer.note),
		...Object.entries(answer.optionNotes ?? {}).map(
			([value, note]) =>
				`${field("Noted option value", value)}\n\n${field("Option note", note)}`
		),
	];
}
