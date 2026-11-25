import type { AskConfig } from "../config/schema.ts";
import {
	getCurrentQuestion,
	getRenderableOptions,
	isSubmitTab,
} from "../state/selectors.ts";
import { isEditingView } from "../state/view.ts";
import type { AskState } from "../types.ts";
import { renderFrameFooter, renderFrameHeader } from "./render-frame.ts";
import { renderQuestionScreen } from "./render-question.ts";
import { renderSubmitScreen } from "./render-submit.ts";
import type {
	AskMouseTarget,
	AskRenderLayout,
	QuestionRenderContext,
	Theme,
} from "./render-types.ts";

export function renderAskScreen(args: {
	config: AskConfig;
	/** Scroll offset of the question context pane, in content rows. */
	contextOffset?: number;
	/** Receives where the scrollable regions ended up. */
	layout?: AskRenderLayout;
	/** Rows the screen may use; the context pane shrinks to fit. Unbounded when omitted. */
	maxRows?: number;
	targets?: AskMouseTarget[];
	footerNotice?: string;
	background?: boolean;
	reviewShortcutHint?: string;
	state: AskState;
	theme: Theme;
	width: number;
	editor: QuestionRenderContext["editor"];
}): string[] {
	const {
		config,
		footerNotice,
		reviewShortcutHint,
		state,
		theme,
		width,
		editor,
	} = args;
	const lines: string[] = [];
	const question = getCurrentQuestion(state);
	const options = getRenderableOptions(question);
	const markActiveRow = Boolean(
		args.background && editor.focused && !isEditingView(state)
	);

	const footerLines: string[] = [];
	renderFrameFooter({
		config,
		footerNotice,
		lines: footerLines,
		state,
		theme,
		width,
		background: args.background,
	});
	renderFrameHeader({ lines, state, theme, width, targets: args.targets });

	if (isSubmitTab(state)) {
		renderSubmitScreen(
			lines,
			state,
			theme,
			width,
			reviewShortcutHint,
			markActiveRow,
			args.targets,
			editor
		);
	} else if (question) {
		renderQuestionScreen({
			availableRows:
				args.maxRows === undefined
					? undefined
					: args.maxRows - footerLines.length,
			contextOffset: args.contextOffset,
			layout: args.layout,
			lines,
			state,
			question,
			options,
			markActiveRow,
			targets: args.targets,
			theme,
			width,
			editor,
		});
	}

	lines.push(...footerLines);
	return lines;
}
