import { UI_DIMENSIONS, UI_TEXT } from "../../constants/ui.ts";
import { withImageMarker } from "../../images.ts";
import { hasCustomAnswer, isOptionSelected } from "../../state/answers.ts";
import {
	getAnswer,
	getOptionNote,
	getQuestionNote,
	isInputOpenForQuestion,
	isOptionNoteOpen,
	isQuestionNoteOpen,
} from "../../state/selectors.ts";
import type { AskDisplayOption } from "../../types.ts";
import type { QuestionRenderContext } from "../render-types.ts";

export type QuestionNoteModel =
	| { kind: "editor"; placeholder: string }
	| { kind: "saved"; text: string };

export type OptionDetailModel =
	| { kind: "editor"; placeholder: string }
	| { kind: "saved-note"; text: string }
	| { kind: "custom-text"; text: string };

export interface OptionRowModel {
	color: "accent" | "text" | "success";
	description?: string;
	detail?: OptionDetailModel;
	index: number;
	isCustom: boolean;
	label: string;
	pointer: string;
	prefix: string;
	recommended: boolean;
	selected: boolean;
}

export interface QuestionScreenModel {
	mode: "preview" | "standard";
	previewLayout?: "custom" | "stacked" | "wide";
	questionNote?: QuestionNoteModel;
	rows: OptionRowModel[];
	selectedOption?: AskDisplayOption;
	selectedOptionDetail?: OptionDetailModel;
}

export function buildQuestionScreenModel(
	context: QuestionRenderContext
): QuestionScreenModel {
	const rows = context.options.map((option, index) =>
		buildOptionRowModel(context, option, index)
	);
	const questionNote = buildQuestionNoteModel(context);
	if (context.question.type !== "preview") {
		return {
			mode: "standard",
			questionNote,
			rows,
		};
	}

	const selectedOption = context.options[context.state.activeOptionIndex];
	return {
		mode: "preview",
		previewLayout: getPreviewLayout(context, selectedOption),
		questionNote,
		rows,
		selectedOption,
		selectedOptionDetail: buildOptionDetailModel(context, selectedOption, true),
	};
}

function buildQuestionNoteModel(
	context: QuestionRenderContext
): QuestionNoteModel | undefined {
	const { state, question } = context;
	if (isQuestionNoteOpen(state, question.id)) {
		return { kind: "editor", placeholder: UI_TEXT.editorPlaceholderNote };
	}
	const note = withImageMarker(
		getQuestionNote(state, question.id),
		getAnswer(state, question.id)?.noteImages
	);
	return note ? { kind: "saved", text: note } : undefined;
}

function buildOptionRowModel(
	context: QuestionRenderContext,
	option: AskDisplayOption,
	index: number
): OptionRowModel {
	const { question, state } = context;
	const answer = getAnswer(state, question.id);
	const selected = index === state.activeOptionIndex;
	const answered = option.isCustomOption
		? !!(answer?.customSelected && hasCustomAnswer(answer))
		: isOptionSelected(answer, option.value);
	const pointer = getOptionPointer(selected);
	return {
		color: getOptionColor(answered, selected),
		description: option.description,
		detail:
			context.question.type === "preview"
				? undefined
				: buildOptionDetailModel(context, option, selected),
		index,
		isCustom: !!option.isCustomOption,
		label: option.label,
		pointer,
		prefix: getOptionPrefix(question.type, option, answered),
		recommended: option.recommended === true,
		selected,
	};
}

function getOptionPointer(selected: boolean): string {
	return selected ? "❯ " : "  ";
}

function buildOptionDetailModel(
	context: QuestionRenderContext,
	option: AskDisplayOption | undefined,
	selected: boolean
): OptionDetailModel | undefined {
	if (!option) {
		return;
	}

	const { state, question } = context;
	const answer = getAnswer(state, question.id);
	const inputOpen =
		!!option.isCustomOption &&
		selected &&
		isInputOpenForQuestion(state, question.id);
	const noteOpen =
		!option.isCustomOption &&
		isOptionNoteOpen(state, question.id, option.value);
	const customText = option.isCustomOption
		? withImageMarker(answer?.customText, answer?.customImages)
		: undefined;
	const note = option.isCustomOption
		? undefined
		: withImageMarker(
				getOptionNote(state, question.id, option.value),
				answer?.optionNoteImages?.[option.value]
			);

	if (noteOpen) {
		return {
			kind: "editor",
			placeholder: UI_TEXT.editorPlaceholderNote,
		};
	}
	if (inputOpen) {
		return {
			kind: "editor",
			placeholder: UI_TEXT.editorPlaceholderInput,
		};
	}
	if (customText) {
		return {
			kind: "custom-text",
			text: customText,
		};
	}
	if (note) {
		return { kind: "saved-note", text: note };
	}
	return;
}

function getPreviewLayout(
	context: QuestionRenderContext,
	selectedOption: AskDisplayOption | undefined
): "custom" | "stacked" | "wide" {
	if (selectedOption?.isCustomOption) {
		return "custom";
	}
	return context.width >= UI_DIMENSIONS.previewWideMinWidth &&
		context.options.length > 0
		? "wide"
		: "stacked";
}

function getOptionPrefix(
	questionType: QuestionRenderContext["question"]["type"],
	_option: AskDisplayOption,
	answered: boolean
): string {
	if (questionType !== "multi") {
		return "";
	}
	return `[${answered ? "x" : " "}] `;
}

function getOptionColor(
	answered: boolean,
	selected: boolean
): "accent" | "text" | "success" {
	if (answered) {
		return "success";
	}
	if (selected) {
		return "accent";
	}
	return "text";
}
