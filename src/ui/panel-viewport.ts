import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { clamp } from "../math.ts";

/** Keep a tall questionnaire from pushing the normal editor out of the viewport. */
export function panelViewport(
	lines: string[],
	height: number,
	offset: number,
	followSelection: boolean
): { lines: string[]; offset: number } {
	const rows = Math.max(1, height);
	let top = clamp(offset, 0, Math.max(0, lines.length - rows));
	if (followSelection) {
		const active = lines.findIndex((line) => line.includes(CURSOR_MARKER));
		if (active >= 0 && active < top) {
			top = active;
		}
		if (active >= top + rows) {
			top = active - rows + 1;
		}
	}
	return { lines: lines.slice(top, top + rows), offset: top };
}
