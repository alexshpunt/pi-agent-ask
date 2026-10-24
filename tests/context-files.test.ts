import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveContextFiles } from "../src/context-files.ts";
import type { AskParams } from "../src/types.ts";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

function params(context: string): AskParams {
	return {
		questions: [
			{
				id: "choice",
				prompt: "Accept this document?",
				context,
				options: [{ value: "accept", label: "Accept" }],
			},
		],
	};
}

test("an absolute file path becomes the file's text without changing the input", async () => {
	const path = resolve(fixtures, "context.txt");
	const input = params(path);
	const result = await resolveContextFiles(input);
	if (!result.ok) {
		assert.fail(JSON.stringify(result.issues));
	}
	assert.equal(
		result.params.questions[0].context,
		await readFile(path, "utf8")
	);
	assert.equal(input.questions[0].context, path);
});

test("text and relative paths stay text", async () => {
	for (const context of [
		"Plain explanation for the user.",
		"fixtures/context.txt",
		"Line one\n/an/absolute/looking/second/line",
	]) {
		const input = params(context);
		assert.deepEqual(await resolveContextFiles(input), {
			ok: true,
			params: input,
		});
	}
});

test("a missing absolute path returns a context field error with a fix", async () => {
	const result = await resolveContextFiles(
		params(resolve(fixtures, "missing.txt"))
	);
	if (result.ok) {
		assert.fail("Expected a file error");
	}
	assert.equal(result.issues[0].path, "questions[0].context");
	assert(result.issues[0].message.includes("missing.txt"));
	assert(result.issues[0].message.includes("or pass the text itself"));
});

test("directories, empty files, and binary files are rejected", async () => {
	for (const path of [
		fixtures,
		resolve(fixtures, "empty.txt"),
		resolve(fixtures, "../../docs/media/pi-ask-main.png"),
	]) {
		const result = await resolveContextFiles(params(path));
		assert.equal(result.ok, false, path);
	}
});
