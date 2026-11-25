import {
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { clamp } from "../math.ts";
import { isSubmitTab } from "../state/selectors.ts";
import type { AskState } from "../types.ts";
import { foregroundFormRows, panelViewport } from "./panel-viewport.ts";
import type { AskMouseTarget, AskRenderLayout, Theme } from "./render-types.ts";

/** Scroll positions of one question form: its context pane and, in the foreground, the whole form. */
export interface FormScroll {
	/** Scroll offset of the question context pane, in content rows. */
	contextOffset: number;
	/** Whether the foreground viewport keeps the active row visible. */
	followView: boolean;
	/** Scrollable regions found by the last render, in mouse coordinates. */
	layout: AskRenderLayout;
	/** Tab shown at the last render; positions reset when it changes. */
	tab: number;
	/** Largest `viewTop` of the last render. */
	viewMax: number;
	/** First visible row of a foreground form taller than the screen. */
	viewTop: number;
}

export function createFormScroll(): FormScroll {
	return {
		contextOffset: 0,
		followView: true,
		layout: {},
		tab: -1,
		viewMax: 0,
		viewTop: 0,
	};
}

/** Start a render: forget last frame's layout and reset positions on a new tab. */
export function beginFormRender(scroll: FormScroll, activeTab: number) {
	scroll.layout = {};
	if (scroll.tab !== activeTab) {
		scroll.tab = activeTab;
		scroll.contextOffset = 0;
		scroll.viewTop = 0;
		scroll.followView = true;
	}
}

/** Remember the pane offset the renderer settled on after clamping it. */
export function endFormRender(scroll: FormScroll) {
	if (scroll.layout.contextPane) {
		scroll.contextOffset = scroll.layout.contextPane.offset;
	}
}

/** Show the part of a form taller than the screen, keeping the active row in view. */
export function fitToScreen(args: {
	columns: number;
	lines: string[];
	maxRows: number;
	scroll: FormScroll;
	state: AskState;
	targets: AskMouseTarget[];
	theme: Pick<Theme, "fg">;
}): string[] {
	const { lines, maxRows, scroll, targets } = args;
	if (lines.length <= maxRows) {
		scroll.viewTop = 0;
		scroll.viewMax = 0;
		return lines;
	}
	const rows = maxRows - 1;
	scroll.viewMax = lines.length - rows;
	const view = panelViewport(
		lines,
		rows,
		scroll.viewTop,
		scroll.followView,
		findActiveRow(args.state, targets)
	);
	scroll.viewTop = view.offset;
	for (const target of targets) {
		target.y -= view.offset;
	}
	if (scroll.layout.contextPane) {
		scroll.layout.contextPane.y -= view.offset;
	}
	const hint = `PgUp/PgDn or wheel: scroll · ${view.offset + 1}–${view.offset + view.lines.length} / ${lines.length}`;
	return [
		...view.lines,
		args.theme.fg("dim", truncateToWidth(hint, args.columns)),
	];
}

/** Row of the highlighted option or review action in the last full render. */
function findActiveRow(
	state: AskState,
	targets: AskMouseTarget[]
): number | undefined {
	const submit = isSubmitTab(state);
	const index = submit
		? state.activeSubmitActionIndex
		: state.activeOptionIndex;
	return targets.find(
		(target) =>
			target.kind === (submit ? "submit" : "option") && target.index === index
	)?.y;
}

/** Move the context pane; false when it cannot move that way. */
function scrollContext(scroll: FormScroll, delta: number): boolean {
	const pane = scroll.layout.contextPane;
	if (!pane) {
		return false;
	}
	const next = clamp(pane.offset + delta, 0, pane.maxOffset);
	if (next === pane.offset) {
		return false;
	}
	scroll.contextOffset = next;
	pane.offset = next;
	return true;
}

/** Move the foreground viewport over a form taller than the screen. */
function scrollView(scroll: FormScroll, delta: number): boolean {
	const top = clamp(scroll.viewTop + delta, 0, scroll.viewMax);
	if (top === scroll.viewTop) {
		return false;
	}
	scroll.followView = false;
	scroll.viewTop = top;
	return true;
}

/** Scroll the pane, then (foreground only) the whole form, by one page. */
export function scrollFormPage(
	scroll: FormScroll,
	args: { background: boolean; direction: -1 | 1; terminalRows: number }
): boolean {
	const page = Math.max(1, (scroll.layout.contextPane?.height ?? 0) - 3);
	if (scrollContext(scroll, args.direction * page)) {
		return true;
	}
	if (args.background) {
		return false;
	}
	const rows = foregroundFormRows(args.terminalRows);
	return scrollView(scroll, args.direction * (rows - 2));
}

/** Wheel over the pane scrolls it; elsewhere, or at its end, a foreground form scrolls whole. */
export function scrollFormWheel(
	scroll: FormScroll,
	event: TuiMouseEvent,
	background: boolean
): TuiMouseEventResult | undefined {
	if (!event.wheelDelta || event.shift || event.alt || event.ctrl) {
		return;
	}
	if (isOverPane(scroll, event) && scrollContext(scroll, event.wheelDelta)) {
		return { handled: true };
	}
	if (background) {
		return;
	}
	return scrollView(scroll, event.wheelDelta) ? { handled: true } : undefined;
}

function isOverPane(scroll: FormScroll, event: TuiMouseEvent): boolean {
	const pane = scroll.layout.contextPane;
	return (
		!!pane &&
		event.x >= pane.x &&
		event.x < pane.x + pane.width &&
		event.y >= pane.y &&
		event.y < pane.y + pane.height
	);
}
