import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ROWS = 40;
const COLS = 120;

interface Frame {
	columns: number;
	lines: string[];
	rows: number;
}

const PARAGRAPH_PATTERN = /Context paragraph (\d+) /;
const firstParagraph = (frame: Frame) =>
	PARAGRAPH_PATTERN.exec(frame.lines.join("\n"))?.[1];

test("a huge foreground context stays inside the screen and scrolls", {
	timeout: 90_000,
}, async () => {
	await mkdir(join(root, ".tmp"), { recursive: true });
	const workspace = await mkdtemp(join(root, ".tmp", "scroll-context-"));
	try {
		const context = Array.from(
			{ length: 400 },
			(_, index) =>
				`Context paragraph ${index + 1} ${"lorem ipsum ".repeat(14)}`
		).join("\n\n");
		await new PiIntegrationTest({
			testName: "scroll-context",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd: workspace,
			isolateUserResources: true,
			extensions: [
				join(root, "src/index.ts"),
				join(root, "tests/fixtures/scroll-driver.ts"),
			],
			tools: ["ask_user"],
			rawMode: false,
			tuiSize: { cols: COLS, rows: ROWS },
			conversation: [
				assistantMessage(
					[
						toolCall({
							id: "form",
							name: "ask_user",
							arguments: {
								questions: [
									{
										id: "accept",
										prompt: "Accept the proposal?",
										context,
										options: [
											{
												value: "yes",
												label: "Accept",
												recommended: true,
											},
										],
									},
								],
							},
						}),
					],
					{ stopReason: "toolUse" }
				),
				assistantMessage([text("The proposal was accepted.")]),
			],
		}).run("Ask the question.");
		const frames = JSON.parse(
			await readFile(join(workspace, "scroll-frames.json"), "utf8")
		) as Record<string, Frame>;
		for (const [name, frame] of Object.entries(frames)) {
			assert(
				frame.lines.length <= frame.rows,
				`${name} rendered ${frame.lines.length} of ${frame.rows} rows`
			);
		}
		assert.equal(firstParagraph(frames.initial), "1");
		const paged = Number(firstParagraph(frames.pageDown));
		assert(paged > 1, "PgDn scrolled the context");
		assert(Number(firstParagraph(frames.pageDown2)) > paged);
		assert.equal(Number(firstParagraph(frames.pageUp)), paged);
		assert(Number(firstParagraph(frames.wheel)) > paged);
		assert(frames.initial.lines.some((line) => line.includes("Accept")));
		assert(frames.initial.lines.some((line) => line.includes("more · PgDn")));
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
