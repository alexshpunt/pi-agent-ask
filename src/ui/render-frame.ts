import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AskConfig } from "../config/schema.ts";
import {
	getCurrentQuestion,
	isQuestionAnswered,
	isSubmitTab,
} from "../state/selectors.ts";
import { wrapText } from "../text.ts";
import type { AskState } from "../types.ts";
import { renderFooterText } from "./render-helpers.ts";
import type { AskMouseTarget, Theme } from "./render-types.ts";

export function renderFrameHeader(args: {
	targets?: AskMouseTarget[];
	lines: string[];
	state: AskState;
	theme: Theme;
	width: number;
}) {
	const { lines, state, theme, width } = args;
	const add = (text = "") => lines.push(truncateToWidth(text, width));

	add(theme.fg("accent", "─".repeat(Math.max(1, width))));
	if (state.title) {
		add(` ${theme.fg("accent", theme.bold(state.title))}`);
		add();
	}
	add(renderTabs(state, theme, width, lines.length, args.targets));
	add();
}

export function renderFrameFooter(args: {
	config: AskConfig;
	footerNotice?: string;
	background?: boolean;
	lines: string[];
	state: AskState;
	theme: Theme;
	width: number;
}) {
	const { config, footerNotice, lines, state, theme, width } = args;
	const add = (text = "") => lines.push(truncateToWidth(text, width));
	const footer = renderFooter(config, state, width, args.background);
	const noticeLines = footerNotice ? wrapText(footerNotice, width) : [];
	if (noticeLines.length > 0 || footer.length > 0) {
		add();
		for (const line of noticeLines) {
			add(theme.fg("warning", line));
		}
		for (const line of footer) {
			add(theme.fg("dim", line));
		}
	}
	add(theme.fg("accent", "─".repeat(Math.max(1, width))));
}

const TAB_PREFIX = " ← ";
const TAB_SUFFIX = " →";
const TAB_SEPARATOR_WIDTH = visibleWidth(" ");

function renderTabs(
	state: AskState,
	theme: Theme,
	width: number,
	y: number,
	targets?: AskMouseTarget[]
): string {
	const tabs = state.questions.map((question, index) => {
		const active = state.activeTabIndex === index;
		const answered = isQuestionAnswered(state, question.id);
		const marker = answered ? "☒" : "☐";
		const text = ` ${marker} ${question.label} `;
		return {
			text,
			width: visibleWidth(text),
			render: active
				? theme.bg("selectedBg", theme.fg("text", text))
				: theme.fg(answered ? "success" : "muted", text),
		};
	});

	const reviewText = " ☰ Review ";
	tabs.push({
		text: reviewText,
		width: visibleWidth(reviewText),
		render: isSubmitTab(state)
			? theme.bg("selectedBg", theme.fg("text", reviewText))
			: theme.fg("success", reviewText),
	});

	const activeIndex = Math.min(state.activeTabIndex, tabs.length - 1);
	const availableTabWidth = Math.max(
		1,
		width - visibleWidth(TAB_PREFIX) - visibleWidth(TAB_SUFFIX)
	);
	const { start, end } = getVisibleTabRange(
		tabs.map((tab) => tab.width),
		activeIndex,
		availableTabWidth
	);
	let x = visibleWidth(TAB_PREFIX);
	for (let index = start; index <= end; index += 1) {
		const tabWidth = tabs[index].width;
		const targetWidth = Math.min(tabWidth, width - x);
		if (targetWidth > 0) {
			targets?.push({
				kind: "tab",
				index,
				x,
				y,
				width: targetWidth,
				height: 1,
			});
		}
		x += tabWidth + TAB_SEPARATOR_WIDTH;
	}
	const leftArrow = theme.fg("dim", TAB_PREFIX.trimStart());
	const rightArrow = theme.fg("dim", TAB_SUFFIX);
	const visibleTabs = tabs
		.slice(start, end + 1)
		.map((tab) => tab.render)
		.join(" ");
	return truncateToWidth(
		`${TAB_PREFIX[0]}${leftArrow}${visibleTabs}${rightArrow}`,
		width
	);
}

function getVisibleTabRange(
	widths: number[],
	activeIndex: number,
	availableWidth: number
): { start: number; end: number } {
	if (widths.length === 0) {
		return { start: 0, end: -1 };
	}

	const totalWidth =
		widths.reduce((sum, width) => sum + width, 0) +
		Math.max(0, widths.length - 1) * TAB_SEPARATOR_WIDTH;
	if (totalWidth <= availableWidth) {
		return { start: 0, end: widths.length - 1 };
	}

	const range = { start: activeIndex, end: activeIndex };
	let usedWidth = widths[activeIndex] ?? 0;
	let preferRight = activeIndex <= widths.length - activeIndex - 1;

	while (true) {
		const expansion = getExpandableTab(
			widths,
			range,
			availableWidth,
			usedWidth,
			preferRight
		);
		if (!expansion) {
			return range;
		}
		usedWidth += TAB_SEPARATOR_WIDTH + expansion.width;
		applyTabGrowth(range, expansion.nextIndex, expansion.direction);
		preferRight = !preferRight;
	}
}

function getExpandableTab(
	widths: number[],
	range: { start: number; end: number },
	availableWidth: number,
	usedWidth: number,
	preferRight: boolean
):
	| { direction: "left" | "right"; nextIndex: number; width: number }
	| undefined {
	for (const direction of getGrowthDirections(preferRight)) {
		const nextIndex = getNextTabIndex(range, direction);
		const nextWidth = widths[nextIndex];
		if (
			nextWidth === undefined ||
			usedWidth + TAB_SEPARATOR_WIDTH + nextWidth > availableWidth
		) {
			continue;
		}
		return { direction, nextIndex, width: nextWidth };
	}
	return;
}

function getGrowthDirections(preferRight: boolean): Array<"left" | "right"> {
	return preferRight ? ["right", "left"] : ["left", "right"];
}

function getNextTabIndex(
	range: { start: number; end: number },
	direction: "left" | "right"
): number {
	return direction === "left" ? range.start - 1 : range.end + 1;
}

function applyTabGrowth(
	range: { start: number; end: number },
	nextIndex: number,
	direction: "left" | "right"
) {
	if (direction === "left") {
		range.start = nextIndex;
		return;
	}
	range.end = nextIndex;
}

function renderFooter(
	config: AskConfig,
	state: AskState,
	width: number,
	background = false
): string[] {
	if (!config.behaviour.showFooterHints) {
		return [];
	}
	let footer: string;
	if (state.view.kind === "input") {
		footer = renderFooterText(config, "input", background);
	} else if (state.view.kind === "note") {
		footer = renderFooterText(config, "note", background);
	} else if (isSubmitTab(state)) {
		footer = renderFooterText(config, "submit", background);
	} else {
		const question = getCurrentQuestion(state);
		footer = renderFooterText(
			config,
			question?.type === "multi" ? "multi" : "default",
			background
		);
	}
	return wrapDelimitedFooterHints(footer, width);
}

function wrapDelimitedFooterHints(footer: string, width: number): string[] {
	return footer.split(" · ").reduce<string[]>((lines, chunk) => {
		const current = lines.at(-1) ?? "";
		const next = current ? `${current} · ${chunk}` : chunk;
		const fitsCurrentLine = visibleWidth(next) <= width;
		if (fitsCurrentLine) {
			if (current) {
				lines[lines.length - 1] = next;
			} else {
				lines.push(next);
			}
			return lines;
		}

		const wrappedChunk = wrapText(chunk, width);
		if (!current) {
			lines.push(...wrappedChunk);
			return lines;
		}
		lines.push(...wrappedChunk);
		return lines;
	}, []);
}
