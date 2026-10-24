import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { collectValidationIssues } from "./state/normalize.ts";
import type { AskParams, AskValidationIssue } from "./types.ts";

type ContextResolution =
	| { ok: true; params: AskParams }
	| { ok: false; issues: AskValidationIssue[] };

/** Load file contexts into a copied payload before opening or saving a form. */
export async function resolveContextFiles(
	params: AskParams
): Promise<ContextResolution> {
	const issues = collectValidationIssues(params);
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	const questions: AskParams["questions"] = [];
	for (const [index, question] of params.questions.entries()) {
		const path = contextFilePath(question.context);
		if (!path) {
			questions.push(question);
			continue;
		}
		try {
			questions.push({ ...question, context: await readContextFile(path) });
		} catch (error) {
			issues.push({
				path: `questions[${index}].context`,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return issues.length > 0
		? { ok: false, issues }
		: { ok: true, params: { ...params, questions } };
}

/** A single-line absolute path is a file reference; anything else is text. */
function contextFilePath(context: string | undefined): string | undefined {
	const value = context?.trim();
	return value && !value.includes("\n") && isAbsolute(value)
		? value
		: undefined;
}

async function readContextFile(path: string): Promise<string> {
	try {
		if (!(await stat(path)).isFile()) {
			throw new Error("Expected a regular text file");
		}
		const text = new TextDecoder("utf-8", { fatal: true }).decode(
			await readFile(path)
		);
		if (text.includes("\0")) {
			throw new Error("Expected UTF-8 text, not binary data");
		}
		if (!text.trim()) {
			throw new Error("Context file is empty");
		}
		return text;
	} catch (error) {
		throw new Error(
			`Cannot load context file "${path}": ${error instanceof Error ? error.message : String(error)}. Pass the absolute path of an existing UTF-8 text file, or pass the text itself.`,
			{ cause: error }
		);
	}
}
