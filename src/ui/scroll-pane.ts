import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { clamp } from "../math.ts";
import type { Theme } from "./render-types.ts";

/** A bordered, word-wrapped text box that shows one window of its content. */
export interface ScrollPane {
	/** Rendered box lines, borders included. */
	lines: string[];
	/** Largest valid scroll offset, in content rows. */
	maxOffset: number;
	/** Clamped scroll offset that was rendered, in content rows. */
	offset: number;
}

/** Fewest content rows a pane keeps when the form is short on space. */
export const MIN_PANE_ROWS = 5;

const BORDER_ROWS = 2;
const THUMB = "┃";
const TRACK = "│";

/**
 * Render `text` word-wrapped inside a box. `height` is the box's total row
 * budget; without it the box shows all content. Scroll hints sit in the borders
 * and a thumb on the right border shows the window position.
 */
export function renderScrollPane(args: {
	height?: number;
	offset?: number;
	text: string;
	theme: Pick<Theme, "fg">;
	width: number;
}): ScrollPane {
	const { text, theme } = args;
	const boxWidth = Math.max(6, args.width);
	const innerWidth = boxWidth - 2;
	const wrapped = text
		.split("\n")
		.flatMap((paragraph) =>
			paragraph.length === 0 ? [""] : wrapTextWithAnsi(paragraph, innerWidth)
		);
	const rows =
		args.height === undefined
			? wrapped.length
			: Math.min(
					wrapped.length,
					Math.max(MIN_PANE_ROWS, args.height - BORDER_ROWS)
				);
	const maxOffset = Math.max(0, wrapped.length - rows);
	const offset = clamp(args.offset ?? 0, 0, maxOffset);
	const hiddenAbove = offset;
	const hiddenBelow = maxOffset - offset;
	const thumb = getThumb(rows, wrapped.length, offset, maxOffset);
	const border = (text: string) => theme.fg("accent", text);

	const lines = [
		border(`┌${borderRule("↑ ", "PgUp", hiddenAbove, innerWidth)}┐`),
	];
	for (let row = 0; row < rows; row++) {
		const line = truncateToWidth(wrapped[offset + row] ?? "", innerWidth);
		const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
		const edge = thumb && row >= thumb.start && row < thumb.end ? THUMB : TRACK;
		lines.push(
			`${border(TRACK)}${theme.fg("text", line)}${padding}${border(edge)}`
		);
	}
	lines.push(border(`└${borderRule("↓ ", "PgDn", hiddenBelow, innerWidth)}┘`));
	return { lines, maxOffset, offset };
}

function getThumb(
	rows: number,
	total: number,
	offset: number,
	maxOffset: number
): { end: number; start: number } | undefined {
	if (maxOffset === 0) {
		return;
	}
	const size = clamp(Math.round((rows * rows) / total), 1, rows - 1);
	const start = Math.round((offset / maxOffset) * (rows - size));
	return { start, end: start + size };
}

function borderRule(
	arrow: string,
	key: string,
	hidden: number,
	width: number
): string {
	if (hidden === 0) {
		return "─".repeat(width);
	}
	const long = ` ${arrow}${hidden} more · ${key} `;
	const label = visibleWidth(long) + 2 <= width ? long : ` ${arrow}${hidden} `;
	const labelWidth = visibleWidth(label);
	if (labelWidth > width) {
		return "─".repeat(width);
	}
	return `─${label}${"─".repeat(width - labelWidth - 1)}`;
}
