import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { collectValidationIssues } from "./state/normalize.ts";
import type { AskOption, AskParams, AskValidationIssue } from "./types.ts";

type PreviewResolution =
	| { ok: true; params: AskParams }
	| { ok: false; issues: AskValidationIssue[] };

/** Load local preview files into a copied payload before opening or saving a form. */
export async function resolvePreviewFiles(
	params: AskParams,
	cwd: string
): Promise<PreviewResolution> {
	const issues = collectValidationIssues(params);
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	const questions: AskParams["questions"] = [];
	for (const [questionIndex, question] of params.questions.entries()) {
		const resolvedOptions: AskOption[] = [];
		for (const [optionIndex, option] of question.options.entries()) {
			try {
				resolvedOptions.push(await resolveOptionPreview(option, cwd));
			} catch (error) {
				issues.push({
					path: `questions[${questionIndex}].options[${optionIndex}].previewFile`,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
		questions.push({ ...question, options: resolvedOptions });
	}
	return issues.length > 0
		? { ok: false, issues }
		: { ok: true, params: { ...params, questions } };
}

async function resolveOptionPreview(
	option: AskOption,
	cwd: string
): Promise<AskOption> {
	const previewFile = option.previewFile?.trim();
	if (!previewFile) {
		return option;
	}
	const path = resolve(cwd, previewFile);
	try {
		if (!(await stat(path)).isFile()) {
			throw new Error("Expected a regular text file");
		}
		const preview = new TextDecoder("utf-8", { fatal: true }).decode(
			await readFile(path)
		);
		if (preview.includes("\0")) {
			throw new Error("Expected UTF-8 text, not binary data");
		}
		if (!preview.trim()) {
			throw new Error("Preview file is empty");
		}
		const { previewFile: _file, ...rest } = option;
		return { ...rest, preview };
	} catch (error) {
		throw new Error(
			`Cannot load preview file "${path}": ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
}
