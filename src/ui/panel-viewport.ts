import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { clamp } from "../math.ts";

/** Rows a background panel may use: half the screen, so the normal editor stays usable. */
export function backgroundPanelRows(terminalRows: number): number {
	return Math.max(1, Math.floor((terminalRows - 6) / 2));
}

const FOREGROUND_RESERVED_ROWS = 3;
const FOREGROUND_MIN_ROWS = 8;

/** Rows a foreground form may use: the whole screen minus Pi's own bottom lines. */
export function foregroundFormRows(terminalRows: number): number {
	return Math.max(FOREGROUND_MIN_ROWS, terminalRows - FOREGROUND_RESERVED_ROWS);
}

/**
 * Keep a tall questionnaire from pushing the normal editor out of the viewport.
 * With `followSelection`, the cursor marker wins; `fallbackLine` is the row to keep
 * visible when no marker is rendered.
 */
export function panelViewport(
	lines: string[],
	height: number,
	offset: number,
	followSelection: boolean,
	fallbackLine?: number
): { lines: string[]; offset: number } {
	const rows = Math.max(1, height);
	let top = clamp(offset, 0, Math.max(0, lines.length - rows));
	if (followSelection) {
		const marker = lines.findIndex((line) => line.includes(CURSOR_MARKER));
		const active = marker >= 0 ? marker : (fallbackLine ?? -1);
		if (active >= 0 && active < top) {
			top = active;
		}
		if (active >= top + rows) {
			top = active - rows + 1;
		}
	}
	return { lines: lines.slice(top, top + rows), offset: top };
}
