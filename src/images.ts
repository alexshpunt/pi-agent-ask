import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
	AskImage,
	AskQuestionSummary,
	AskResult,
	AskResultAnswer,
} from "./types.ts";

/** A compact marker for terminal and text summaries; never exposes image bytes. */
export function imageMarker(images: AskImage[] | undefined): string {
	return images?.length
		? `[${images.length} image${images.length === 1 ? "" : "s"}]`
		: "";
}

/** Keep the text and attachment marker together without inventing answer values. */
export function withImageMarker(
	text: string | undefined,
	images: AskImage[] | undefined
): string {
	return [text, imageMarker(images)].filter(Boolean).join(" ");
}

/** Display custom images after the original answer labels, even for image-only answers. */
export function answerDisplayText(answer: AskResultAnswer): string {
	return withImageMarker(answer.labels.join(", "), answer.customImages);
}

function addAnswerImages(
	question: AskQuestionSummary,
	answer: AskResultAnswer | undefined,
	add: (images: AskImage[] | undefined, context: string) => void
): void {
	if (!answer) {
		return;
	}
	const context = `[${question.id}] ${question.prompt}`;
	add(answer.customImages, `${context} — custom answer`);
	add(answer.noteImages, `${context} — question note`);
	for (const [value, images] of Object.entries(answer.optionNoteImages ?? {})) {
		const index = answer.values.indexOf(value);
		add(
			images,
			`${context} — option note for ${answer.labels[index] ?? value}`
		);
	}
}
/** Convert saved attachments to model content with their exact question and note association. */
export function imageContent(
	result: AskResult
): Array<TextContent | ImageContent> {
	if (result.cancelled || result.error) {
		return [];
	}
	const content: Array<TextContent | ImageContent> = [];
	const seen = new Set<string>();
	const add = (images: AskImage[] | undefined, context: string) => {
		for (const image of images ?? []) {
			if (seen.has(image.id)) {
				continue;
			}
			seen.add(image.id);
			content.push(
				{ type: "text", text: `Image for ${context}:` },
				{ type: "image", mimeType: image.mimeType, data: image.data }
			);
		}
	};
	for (const question of result.questions) {
		addAnswerImages(question, result.answers[question.id], add);
	}
	for (const item of result.elaboration?.items ?? []) {
		const target =
			item.target.kind === "option" && "option" in item
				? `option note for ${item.option.label}`
				: "question note";
		add(
			item.images,
			`[${item.question.id}] ${item.question.prompt} — ${target}`
		);
	}
	return content;
}
