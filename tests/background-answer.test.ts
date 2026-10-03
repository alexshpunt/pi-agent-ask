import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	formatQueuedAnswer,
	renderBackgroundAnswer,
} from "../src/background-answer.ts";
import type { QueuedAnswer } from "../src/background-ask-state.ts";

const answer: QueuedAnswer = {
	requestId: "call_long-technical-id",
	result: {
		title: "Browser test",
		cancelled: false,
		mode: "submit",
		questions: [
			{
				id: "source",
				label: "Choice",
				prompt: "Where should the test run?",
				type: "single",
			},
			{
				id: "limit",
				label: "Choice",
				prompt: "How many rows should we show?",
				type: "single",
			},
		],
		answers: {
			source: {
				values: ["browser"],
				labels: ["Agent browser"],
				indices: [1],
				note: "Use the test page",
			},
			limit: {
				values: [],
				labels: ["800, adjustable"],
				indices: [],
				customText: "800, adjustable",
			},
		},
	},
};
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function rendered(value: QueuedAnswer, width = 80): string[] {
	return renderBackgroundAnswer(value, theme, 1).render(width);
}

test("background context links full questions and answers even with duplicate labels", () => {
	const text = formatQueuedAnswer(answer);
	assert(text.includes(`Background answer [${answer.requestId}]`));
	assert(text.includes("Browser test"));
	assert(text.includes("[source] Choice: Where should the test run?"));
	assert(text.includes("[limit] Choice: How many rows should we show?"));
	assert(text.includes("Choice [source]: Agent browser"));
	assert(text.includes("Choice [limit]: 800, adjustable"));
	assert(text.includes("Use the test page"));
});

test("background card shows question-answer pairs without internal identifiers", () => {
	const text = rendered(answer).join("\n");
	assert(text.includes("Answers received"));
	assert(text.includes("Browser test"));
	assert(text.includes("Where should the test run?"));
	assert(text.includes("Agent browser"));
	assert(text.includes("How many rows should we show?"));
	assert(text.includes("800, adjustable"));
	assert(text.includes("Use the test page"));
	assert(!text.includes(answer.requestId));
	assert(text.includes("────────────────"));
	assert(text.includes("→ Agent browser"));
	assert(text.includes("→ 800, adjustable"));
	assert(!text.includes("Answer:"));
	assert(!text.includes("☰ Review"));
	assert(!text.includes("Submit"));
	assert(!text.includes("Cancel"));
	assert(!text.includes("ask:background-answer"));
	assert(!text.includes("[source]"));
	for (const width of [24, 40, 80]) {
		assert(
			rendered(answer, width).every((line) => visibleWidth(line) <= width)
		);
	}
});

test("unanswered questions stay visible and clarification keeps the committed answer", () => {
	assert(answer.result);
	const empty = { ...answer, result: { ...answer.result, answers: {} } };
	assert(rendered(empty).join("\n").includes("→ unanswered"));
	assert(formatQueuedAnswer(empty).includes("Choice [limit]: (no answer)"));
	const elaborate = {
		...answer,
		result: { ...answer.result, mode: "elaborate" as const },
	};
	const text = rendered(elaborate).join("\n");
	assert(text.includes("Clarification requested"));
	assert(text.includes("Agent browser"));
	assert(text.includes("Where should the test run?"));
	assert(!text.includes("Answers received"));
});

test("review style keeps multi-select option notes and unanswered question notes", () => {
	assert(answer.result);
	const multiple = {
		...answer,
		result: {
			...answer.result,
			answers: {
				source: {
					values: ["browser", "local"],
					labels: ["Agent browser", "Local test"],
					indices: [1, 2],
					optionNotes: { browser: "Use the browser page" },
				},
			},
		},
	};
	const text = rendered(multiple).join("\n");
	assert(text.includes("→ Agent browser"));
	assert(text.includes("→ Local test"));
	assert(text.includes("Use the browser page"));
	const noteOnly = {
		...answer,
		result: {
			...answer.result,
			answers: {
				source: {
					values: [],
					labels: [],
					indices: [],
					note: "Explain the available sources",
				},
			},
		},
	};
	const noteText = rendered(noteOnly).join("\n");
	assert(noteText.includes("→ unanswered"));
	assert(noteText.includes("Explain the available sources"));
});

test("cancelled and failed forms are not rendered as received answers", () => {
	assert(answer.result);
	const cancelled = {
		...answer,
		result: { ...answer.result, cancelled: true, answers: {} },
	};
	assert(rendered(cancelled).join("\n").includes("Questions cancelled"));
	assert(!rendered(cancelled).join("\n").includes("Answers received"));
	assert(formatQueuedAnswer(cancelled).includes("Where should the test run?"));
	const failed = { requestId: answer.requestId, error: "Surface unavailable" };
	assert(rendered(failed).join("\n").includes("Question form failed"));
	assert(rendered(failed).join("\n").includes("Surface unavailable"));
	assert(formatQueuedAnswer(failed).includes("Surface unavailable"));
});
