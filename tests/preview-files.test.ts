import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePreviewFiles } from "../src/preview-files.ts";
import type { AskParams } from "../src/types.ts";

const cwd = dirname(fileURLToPath(import.meta.url));
const fixture = "fixtures/preview.txt";

function params(previewFile: string, preview?: string): AskParams {
	return {
		questions: [
			{
				id: "choice",
				prompt: "Pick a document",
				type: "preview",
				options: [
					{ value: "document", label: "Document", previewFile, preview },
				],
			},
		],
	};
}

test("relative and absolute preview files become text without changing the answer", async () => {
	const text = await readFile(resolve(cwd, fixture), "utf8");
	for (const path of [fixture, resolve(cwd, fixture)]) {
		const input = params(path);
		const result = await resolvePreviewFiles(input, cwd);
		if (!result.ok) {
			assert.fail(JSON.stringify(result.issues));
		}
		assert.deepEqual(result.params.questions[0].options[0], {
			value: "document",
			label: "Document",
			preview: text,
		});
		assert.equal(input.questions[0].options[0].previewFile, path);
	}
});

test("missing preview files return a field error", async () => {
	const result = await resolvePreviewFiles(params("fixtures/missing.txt"), cwd);
	assert.equal(result.ok, false);
	if (result.ok) {
		assert.fail("Expected a file error");
	}
	assert.equal(result.issues[0].path, "questions[0].options[0].previewFile");
	assert(result.issues[0].message.includes("missing.txt"));
});

test("an option cannot contain both inline preview and a preview file", async () => {
	const result = await resolvePreviewFiles(params(fixture, "Inline text"), cwd);
	assert.equal(result.ok, false);
	if (result.ok) {
		assert.fail("Expected conflicting sources to fail");
	}
	assert(result.issues[0].message.includes("either preview or previewFile"));
});

test("directories and empty files are not usable previews", async () => {
	for (const path of ["fixtures", "fixtures/empty.txt"]) {
		const result = await resolvePreviewFiles(params(path), cwd);
		assert.equal(result.ok, false);
	}
});

test("binary files are rejected instead of showing corrupted preview text", async () => {
	const result = await resolvePreviewFiles(
		params("../docs/media/pi-ask-main.png"),
		cwd
	);
	assert.equal(result.ok, false);
	if (result.ok) {
		assert.fail("Expected a text decoding error");
	}
	assert.equal(result.issues[0].path, "questions[0].options[0].previewFile");
});
test("inline previews do not need a file and stay unchanged", async () => {
	const input: AskParams = {
		questions: [
			{
				id: "inline",
				prompt: "Pick",
				type: "preview",
				options: [{ value: "a", label: "A", preview: "Inline preview" }],
			},
		],
	};
	const result = await resolvePreviewFiles(input, cwd);
	assert.deepEqual(result, { ok: true, params: input });
});
