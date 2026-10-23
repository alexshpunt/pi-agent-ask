import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { UI_DIMENSIONS, UI_TEXT } from "../constants/ui.ts";
import { imageMarker } from "../images.ts";
import { getEditorImages } from "../state/editor.ts";
import type { AskImage } from "../types.ts";
import {
	measurePreviewLeftWidth,
	mergeColumns,
	pushSavedNote,
	pushWrappedText,
	renderEditorBlock,
	renderPreviewPaneContent,
} from "./render-helpers.ts";
import type {
	AskMouseTarget,
	QuestionRenderContext,
	Theme,
} from "./render-types.ts";
import {
	buildQuestionScreenModel,
	type OptionDetailModel,
	type OptionRowModel,
} from "./view-models/question.ts";

export function renderQuestionScreen(context: QuestionRenderContext) {
	const { lines, question, theme, width } = context;
	const model = buildQuestionScreenModel(context);

	pushWrappedText(lines, question.prompt, width, theme, "text", " ", " ");
	renderQuestionNote(lines, model.questionNote, context);

	if (model.mode === "preview") {
		renderPreviewQuestion(context, model);
		return;
	}

	for (const row of model.rows) {
		renderStandardOption(lines, row, context);
	}
}

function renderQuestionNote(
	lines: string[],
	questionNote: ReturnType<typeof buildQuestionScreenModel>["questionNote"],
	context: QuestionRenderContext
) {
	if (!questionNote) {
		lines.push("");
		return;
	}
	if (questionNote.kind === "editor") {
		renderEditorWithIndent({
			lines,
			editor: context.editor,
			width: context.width,
			theme: context.theme,
			indent: " ",
			padding: UI_DIMENSIONS.editorContentPadding,
			placeholder: questionNote.placeholder,
			images: getEditorImages(context.state),
		});
		lines.push("");
		return;
	}
	pushSavedNote({
		lines,
		note: questionNote.text,
		width: context.width,
		theme: context.theme,
		indent: " ",
	});
	lines.push("");
}

function renderStandardOption(
	lines: string[],
	row: OptionRowModel,
	context: QuestionRenderContext
) {
	const y = lines.length;
	pushWrappedText(
		lines,
		formatOptionLabel(row),
		context.width,
		context.theme,
		row.color,
		row.pointer,
		" ".repeat(visibleWidth(row.pointer))
	);
	renderOptionSubtitle(
		lines,
		row.description,
		row.recommended,
		context.width,
		context.theme
	);
	context.targets?.push({
		kind: "option",
		index: row.index,
		x: 0,
		y,
		width: context.width,
		height: lines.length - y,
	});
	renderOptionDetail(lines, row.detail, context);
}

function renderPreviewQuestion(
	context: QuestionRenderContext,
	model: ReturnType<typeof buildQuestionScreenModel>
) {
	if (model.mode !== "preview") {
		return;
	}
	const { lines, width, theme } = context;
	const wide = model.previewLayout === "wide";
	const leftWidth = wide ? measurePreviewLeftWidth(model.rows, width) : width;
	const optionLines = renderPreviewOptionList(
		model.rows,
		theme,
		leftWidth,
		context.targets,
		lines.length
	);
	if (wide) {
		const rightWidth = Math.max(
			UI_DIMENSIONS.previewMinRightWidth,
			width - leftWidth - 2
		);
		lines.push(
			...mergeColumns(
				optionLines,
				renderPreviewPaneContent(model.selectedOption, theme, rightWidth),
				leftWidth,
				width
			)
		);
	} else {
		lines.push(...optionLines);
		if (model.previewLayout !== "custom") {
			lines.push(
				"",
				...renderPreviewPaneContent(model.selectedOption, theme, width)
			);
		}
	}
	renderOptionDetail(lines, model.selectedOptionDetail, context);
}

function renderPreviewOptionList(
	rows: OptionRowModel[],
	theme: Theme,
	width: number,
	targets?: AskMouseTarget[],
	rowOffset = 0
): string[] {
	const lines: string[] = [];
	for (const row of rows) {
		const y = lines.length;
		pushWrappedText(
			lines,
			`${row.index + 1}. ${row.label}`,
			width,
			theme,
			row.color,
			row.pointer,
			"  "
		);
		renderOptionSubtitle(lines, row.description, row.recommended, width, theme);
		targets?.push({
			kind: "option",
			index: row.index,
			x: 0,
			y: rowOffset + y,
			width,
			height: lines.length - y,
		});
	}
	return lines;
}

function renderOptionDetail(
	lines: string[],
	detail: OptionDetailModel | undefined,
	context: QuestionRenderContext,
	options: { indent?: string } = {}
) {
	if (!detail) {
		return;
	}
	const indent = options.indent ?? "     ";
	const padding =
		indent === " "
			? UI_DIMENSIONS.editorContentPadding
			: UI_DIMENSIONS.editorIndentedPadding;
	if (detail.kind === "editor") {
		renderEditorWithIndent({
			lines,
			editor: context.editor,
			width: context.width,
			theme: context.theme,
			indent,
			padding,
			placeholder: detail.placeholder,
			images: getEditorImages(context.state),
		});
		return;
	}
	if (detail.kind === "saved-note") {
		pushSavedNote({
			lines,
			note: detail.text,
			width: context.width,
			theme: context.theme,
			indent,
		});
		return;
	}
	pushWrappedText(
		lines,
		detail.text,
		context.width,
		context.theme,
		"muted",
		indent,
		indent
	);
}

function renderEditorWithIndent(args: {
	lines: string[];
	editor: QuestionRenderContext["editor"];
	width: number;
	theme: Theme;
	indent: string;
	padding: number;
	placeholder: string;
	images: AskImage[];
}) {
	const { lines, editor, width, theme, indent, padding, placeholder } = args;
	renderEditorBlock({
		lines,
		editorLines: editor.render(
			Math.max(UI_DIMENSIONS.editorMinWidth, width - padding)
		),
		width,
		theme,
		indent,
		availableWidth: width - visibleWidth(indent),
		placeholder,
		isEmpty: editor.getText().length === 0,
	});
	if (args.images.length) {
		pushWrappedText(
			lines,
			imageMarker(args.images),
			width,
			theme,
			"muted",
			indent,
			indent
		);
	}
}

function formatOptionLabel(row: OptionRowModel): string {
	return `${row.index + 1}. ${row.prefix}${row.label}`;
}

function renderOptionSubtitle(
	lines: string[],
	description: string | undefined,
	recommended: boolean,
	width: number,
	theme: Theme
) {
	if (!recommended) {
		if (description) {
			pushWrappedText(
				lines,
				description,
				width,
				theme,
				"muted",
				"     ",
				"     "
			);
		}
		return;
	}

	const indent = "     ";
	const text =
		theme.fg("warning", UI_TEXT.recommendedMarker) +
		(description ? theme.fg("muted", ` | ${description}`) : "");
	for (const line of wrapTextWithAnsi(
		text,
		Math.max(1, width - visibleWidth(indent))
	)) {
		lines.push(truncateToWidth(`${indent}${line}`, width));
	}
}
