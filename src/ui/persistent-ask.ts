import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	matchesKey,
	type OverlayHandle,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AskSurfaceReservation } from "../ask-surface.ts";
import { AskSurfaceLease } from "../ask-surface-lease.ts";
import type { AskResult } from "../types.ts";
import { backgroundPanelRows, panelViewport } from "./panel-viewport.ts";

type CustomArgs = Parameters<Parameters<ExtensionContext["ui"]["custom"]>[0]>;
type FocusAwareTui = CustomArgs[0] & {
	getFocusedComponent?(): Component | null;
};
type AskComponent = Component &
	Partial<Focusable> & {
		dispose?(): void;
		/** Scroll content inside the form; false when nothing there can move. */
		scrollPage?(direction: -1 | 1): boolean;
	};
type AskFactory = (
	tui: CustomArgs[0],
	theme: CustomArgs[1],
	keys: CustomArgs[2],
	done: (result: AskResult) => void
) => AskComponent;

export interface PersistentAskHandle {
	focus(): void;
	isVisible(): boolean;
	setHidden(hidden: boolean): void;
	toggleFocus(): void;
}

export interface PersistentAskOptions {
	hidden: boolean;
	onHandle(handle: PersistentAskHandle | undefined): void;
	onHiddenChange?(hidden: boolean): void;
	signal?: AbortSignal;
	surface?: AskSurfaceReservation;
}

const SURFACE_WIDGET = "ask:active-surface";

/** Render beside the native editor; a non-capturing overlay owns questionnaire focus. */
export async function showPersistentAsk(
	ctx: ExtensionContext,
	factory: AskFactory,
	options: PersistentAskOptions
): Promise<AskResult> {
	const panel = new QuestionPanel(ctx, options);
	try {
		await panel.prepare();
		return await ctx.ui.custom<AskResult>(
			(tui, theme, keys, done) => panel.mount(factory, tui, theme, keys, done),
			{
				overlay: true,
				overlayOptions: { nonCapturing: true },
				onHandle: (handle) => panel.attach(handle),
			}
		);
	} finally {
		panel.dispose();
	}
}

class QuestionPanel implements PersistentAskHandle {
	private readonly ctx: ExtensionContext;
	private readonly options: PersistentAskOptions;
	private component?: AskComponent;
	private overlay?: OverlayHandle;
	private tui?: FocusAwareTui;
	private messageEditor?: Component | null;
	private readonly lease: AskSurfaceLease;
	private disposed = false;
	private scrollTop = 0;
	private followSelection = true;
	private pageSize = 8;
	private renderedOffset = 0;
	private renderedRows = 0;
	private renderedHeight = 0;
	private unsubscribeInput?: () => void;

	constructor(ctx: ExtensionContext, options: PersistentAskOptions) {
		this.ctx = ctx;
		this.options = options;
		this.lease = new AskSurfaceLease({
			...options,
			changed: () => this.updateVisibility(),
		});
	}

	prepare(): Promise<void> {
		this.options.onHandle(this);
		return this.lease.ready();
	}

	isVisible(): boolean {
		return !!this.component && this.lease.visible;
	}

	private updateVisibility(): void {
		this.overlay?.setHidden(!this.lease.visible);
		if (this.lease.visible) {
			this.overlay?.focus();
		}
		this.options.onHandle(this);
		this.tui?.requestRender();
	}

	mount(
		factory: AskFactory,
		tui: CustomArgs[0],
		theme: CustomArgs[1],
		keys: CustomArgs[2],
		done: (result: AskResult) => void
	): AskComponent {
		this.tui = tui;
		this.messageEditor = this.tui.getFocusedComponent?.();
		const onFocusChange = (focused: boolean) => this.onFocusChange(focused);
		const component = factory(tui, theme, keys, done);
		this.component = component;
		this.ctx.ui.setWidget(SURFACE_WIDGET, () => ({
			render: (width) => this.renderWidget(width, theme),
			invalidate: () => component.invalidate(),
			handleMouse: (event) => this.handleMouse(event),
		}));
		this.unsubscribeInput = this.ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "alt+q")) {
				return;
			}
			this.toggleFocus();
			return { consume: true };
		});
		return {
			get focused() {
				return component.focused ?? false;
			},
			set focused(value: boolean) {
				component.focused = value;
				onFocusChange(value);
			},
			render: () => [],
			invalidate: () => component.invalidate(),
			handleInput: (data) => this.handleInput(data),
			dispose: () => this.dispose(),
		};
	}

	attach(overlay: OverlayHandle): void {
		this.overlay = overlay;
		this.updateVisibility();
	}

	setHidden(hidden: boolean): void {
		if (this.disposed) {
			return;
		}
		this.lease.setHidden(hidden).catch((error: unknown) => {
			if (!(this.disposed || this.options.signal?.aborted)) {
				this.ctx.ui.notify(
					`Cannot reopen questions: ${String(error)}`,
					"error"
				);
			}
		});
		this.options.onHiddenChange?.(hidden);
		this.tui?.requestRender();
	}

	focus(): void {
		this.setHidden(false);
	}

	toggleFocus(): void {
		if (!this.overlay) {
			return;
		}
		if (!this.lease.visible) {
			this.setHidden(false);
			return;
		}
		if (this.overlay.isFocused()) {
			this.overlay.unfocus();
		} else {
			this.overlay.focus();
		}
		this.tui?.requestRender();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.unsubscribeInput?.();
		this.options.onHandle(undefined);
		if (this.component) {
			this.ctx.ui.setWidget(SURFACE_WIDGET, undefined);
			this.component.dispose?.();
		}
		this.lease.dispose();
	}

	private onFocusChange(focused: boolean): void {
		if (focused || !this.messageEditor) {
			return;
		}
		// Native mouse focus changes finish after the old focus owner is notified.
		queueMicrotask(() => {
			if (
				this.disposed ||
				!this.lease.visible ||
				this.overlay?.isFocused() ||
				this.tui?.getFocusedComponent?.() !== this.messageEditor
			) {
				return;
			}
			// A click back to ordinary input is an explicit release, not a modal handoff.
			this.overlay?.unfocus();
		});
	}

	private handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (
			!this.lease.visible ||
			this.disposed ||
			event.shift ||
			event.alt ||
			event.ctrl ||
			event.x < 0 ||
			event.x >= event.width ||
			event.y < 0 ||
			event.y >= this.renderedHeight
		) {
			return;
		}
		if (event.type === "wheel" && event.wheelDelta) {
			return this.scrollByWheel(event, event.wheelDelta);
		}
		if (!this.overlay?.isFocused()) {
			return this.focusFromMouse(event);
		}
		const panelClick = event.type === "click" && event.button === "left";
		const result =
			event.y >= 1 && event.y <= this.renderedRows
				? this.component?.handleMouse?.({
						...event,
						y: event.y - 1 + this.renderedOffset,
					})
				: undefined;
		if (!(result?.handled || panelClick)) {
			return;
		}
		if (event.type === "click") {
			this.followSelection = true;
		}
		this.tui?.requestRender();
		return { handled: true };
	}

	/** Content inside the form, such as its context pane, scrolls before the panel does. */
	private scrollByWheel(
		event: TuiMouseEvent,
		delta: number
	): TuiMouseEventResult {
		const inner =
			event.y >= 1 && event.y <= this.renderedRows
				? this.component?.handleMouse?.({
						...event,
						y: event.y - 1 + this.renderedOffset,
					})
				: undefined;
		if (!inner?.handled) {
			this.followSelection = false;
			this.scrollTop = Math.max(0, this.renderedOffset + delta);
		}
		return { handled: true };
	}

	private focusFromMouse(
		event: TuiMouseEvent
	): TuiMouseEventResult | undefined {
		if (event.button !== "left") {
			return;
		}
		if (event.type === "press") {
			return { handled: true, render: false };
		}
		if (event.type !== "click") {
			return;
		}
		this.overlay?.focus();
		this.followSelection = true;
		this.tui?.requestRender();
		return { handled: true };
	}
	private handleInput(data: string): void {
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
			if (this.component?.scrollPage?.(matchesKey(data, "pageUp") ? -1 : 1)) {
				this.tui?.requestRender();
				return;
			}
			this.followSelection = false;
			this.scrollTop = Math.max(
				0,
				this.scrollTop +
					(matchesKey(data, "pageUp") ? -this.pageSize : this.pageSize)
			);
			this.tui?.requestRender();
			return;
		}
		this.followSelection = true;
		this.component?.handleInput?.(data);
	}

	private renderWidget(width: number, theme: CustomArgs[1]): string[] {
		if (!this.lease.visible || this.disposed) {
			return [];
		}
		this.pageSize = backgroundPanelRows(this.tui?.terminal?.rows ?? 24);
		const lines = this.component?.render(width) ?? [];
		const view = panelViewport(
			lines,
			this.pageSize,
			this.scrollTop,
			this.followSelection
		);
		this.scrollTop = view.offset;
		this.renderedOffset = view.offset;
		this.renderedRows = view.lines.length;
		const hint = this.overlay?.isFocused()
			? "Questions · Alt+Q: message · Esc: defer all · D: skip question"
			: "Questions · Alt+Q: answer · normal input remains available";
		const rendered = [
			theme.fg("dim", truncateToWidth(hint, width)),
			...view.lines,
		];
		if (lines.length > this.pageSize) {
			rendered.push(
				theme.fg(
					"dim",
					truncateToWidth(
						`PgUp/PgDn: scroll questions · ${view.offset + 1}–${view.offset + view.lines.length} / ${lines.length}`,
						width
					)
				)
			);
		}
		this.renderedHeight = rendered.length;
		return rendered;
	}
}
