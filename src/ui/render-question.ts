import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { UI_DIMENSIONS, UI_TEXT } from "../constants/ui.ts";
import { imageMarker } from "../images.ts";
import { clamp } from "../math.ts";
import { getEditorImages } from "../state/editor.ts";
import type { AskImage } from "../types.ts";
import {
	measurePreviewLeftWidth,
	mergeColumns,
	pushSavedNote,
	pushWrappedText,
	renderContextPane,
	renderEditorBlock,
} from "./render-helpers.ts";
import type { QuestionRenderContext, Theme } from "./render-types.ts";
import type { ScrollPane } from "./scroll-pane.ts";
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

	if (model.mode === "context") {
		renderContextQuestion(context, model);
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

function renderContextQuestion(
	context: QuestionRenderContext,
	model: ReturnType<typeof buildQuestionScreenModel>
) {
	if (!(model.mode === "context" && model.context)) {
		return;
	}
	const { lines, width } = context;
	const wide = model.contextLayout === "wide";
	const leftWidth = wide
		? measurePreviewLeftWidth(
				model.rows.map((row) => ({ ...row, label: row.prefix + row.label })),
				width
			)
		: width;
	const optionLines = renderContextOptionList(
		model.rows,
		{ ...context, width: leftWidth },
		lines.length
	);
	if (wide) {
		renderWideContext({ context, model, optionLines, leftWidth });
		return;
	}
	lines.push(...optionLines);
	if (model.contextLayout !== "custom") {
		const pane = renderContextPane(model.context, context.theme, width, {
			offset: context.contextOffset,
			height: remainingRows(context, 1, 0),
		});
		lines.push("");
		reportContextPane(context, pane, 0, lines.length, width);
		lines.push(...pane.lines);
	}
	renderOptionDetail(lines, model.selectedOptionDetail, context);
}

/** Rows the pane may use: what the screen leaves after the lines around it. */
function remainingRows(
	context: QuestionRenderContext,
	reserved: number,
	detailRows: number
): number | undefined {
	return context.availableRows === undefined
		? undefined
		: context.availableRows - context.lines.length - reserved - detailRows;
}

/** Options, context pane and, while an editor is open, a note column of its own. */
function renderWideContext(args: {
	context: QuestionRenderContext;
	leftWidth: number;
	model: ReturnType<typeof buildQuestionScreenModel>;
	optionLines: string[];
}) {
	const { context, leftWidth, model, optionLines } = args;
	const { lines, width } = context;
	const rightTotal = Math.max(
		UI_DIMENSIONS.previewMinRightWidth,
		width - leftWidth - 2
	);
	const sideWidth = model.selectedOptionDetail
		? getSideEditorWidth(rightTotal)
		: 0;
	const detailLines: string[] = [];
	renderOptionDetail(
		detailLines,
		model.selectedOptionDetail,
		sideWidth ? { ...context, width: sideWidth } : context,
		sideWidth ? { indent: " " } : {}
	);
	const paneWidth = sideWidth ? rightTotal - sideWidth - 2 : rightTotal;
	const pane = renderContextPane(
		model.context ?? "",
		context.theme,
		paneWidth,
		{
			offset: context.contextOffset,
			height: remainingRows(context, 0, sideWidth ? 0 : detailLines.length),
		}
	);
	reportContextPane(context, pane, leftWidth + 2, lines.length, paneWidth);
	const withPane = mergeColumns(optionLines, pane.lines, leftWidth, width);
	if (sideWidth) {
		// The context narrows so the note stays readable and keeps its place beside it.
		lines.push(
			...mergeColumns(withPane, detailLines, leftWidth + 2 + paneWidth, width)
		);
		return;
	}
	lines.push(...withPane, ...detailLines);
}

/** Width of the editor column beside the context, or 0 when the screen is too narrow for three columns. */
function getSideEditorWidth(rightTotal: number): number {
	if (rightTotal < UI_DIMENSIONS.sideEditorMinTotal) {
		return 0;
	}
	return clamp(
		Math.floor(rightTotal * UI_DIMENSIONS.sideEditorRatio),
		UI_DIMENSIONS.sideEditorMinWidth,
		UI_DIMENSIONS.sideEditorMaxWidth
	);
}

function reportContextPane(
	context: QuestionRenderContext,
	pane: ScrollPane,
	x: number,
	y: number,
	width: number
) {
	if (!context.layout) {
		return;
	}
	context.layout.contextPane = {
		height: pane.lines.length,
		maxOffset: pane.maxOffset,
		offset: pane.offset,
		width,
		x,
		y,
	};
}

/** Render options in the context layout, with saved notes and custom text under their rows. */
function renderContextOptionList(
	rows: OptionRowModel[],
	context: QuestionRenderContext,
	rowOffset: number
): string[] {
	const { theme, width, targets } = context;
	const lines: string[] = [];
	for (const row of rows) {
		const y = lines.length;
		pushWrappedText(
			lines,
			formatOptionLabel(row),
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
		renderOptionDetail(lines, row.detail, context);
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
	const { lines, editor, theme, indent, padding, placeholder } = args;
	// Lines much longer than ~100 characters are hard to read, so the editor stops widening there.
	const width = Math.min(args.width, UI_DIMENSIONS.editorMaxWidth);
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
