import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	matchesKey,
	type OverlayHandle,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AskResult } from "../types.ts";
import { panelViewport } from "./panel-viewport.ts";

type CustomArgs = Parameters<Parameters<ExtensionContext["ui"]["custom"]>[0]>;
type AskComponent = Component & Partial<Focusable> & { dispose?(): void };
type AskFactory = (
	tui: CustomArgs[0],
	theme: CustomArgs[1],
	keys: CustomArgs[2],
	done: (result: AskResult) => void
) => AskComponent;

export interface PersistentAskHandle {
	setHidden(hidden: boolean): void;
	toggleFocus(): void;
}

export interface PersistentAskOptions {
	hidden: boolean;
	onComplete?(focused: boolean): void;
	onHandle(handle: PersistentAskHandle | undefined): void;
	onHiddenChange?(hidden: boolean): void;
}

const SURFACE_WIDGET = "ask:active-surface";

/** Render beside the native editor; an empty non-capturing overlay owns only explicit focus. */
export async function showPersistentAsk(
	ctx: ExtensionContext,
	factory: AskFactory,
	options: PersistentAskOptions
): Promise<AskResult> {
	const panel = new QuestionPanel(ctx, options);
	try {
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
	private tui?: CustomArgs[0];
	private hidden: boolean;
	private disposed = false;
	private scrollTop = 0;
	private followSelection = true;
	private pageSize = 8;
	private unsubscribeInput?: () => void;

	constructor(ctx: ExtensionContext, options: PersistentAskOptions) {
		this.ctx = ctx;
		this.options = options;
		this.hidden = options.hidden;
	}

	mount(
		factory: AskFactory,
		tui: CustomArgs[0],
		theme: CustomArgs[1],
		keys: CustomArgs[2],
		done: (result: AskResult) => void
	): AskComponent {
		this.tui = tui;
		const component = factory(tui, theme, keys, (result) => {
			this.options.onComplete?.(this.overlay?.isFocused() ?? false);
			done(result);
		});
		this.component = component;
		this.ctx.ui.setWidget(SURFACE_WIDGET, () => ({
			render: (width) => this.renderWidget(width, theme),
			invalidate: () => component.invalidate(),
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
			},
			render: () => [],
			invalidate: () => component.invalidate(),
			handleInput: (data) => this.handleInput(data),
			dispose: () => this.dispose(),
		};
	}

	attach(overlay: OverlayHandle): void {
		this.overlay = overlay;
		if (this.hidden) {
			overlay.setHidden(true);
		}
		this.options.onHandle(this);
	}

	setHidden(hidden: boolean): void {
		this.hidden = hidden;
		this.overlay?.setHidden(hidden);
		this.options.onHiddenChange?.(hidden);
		this.tui?.requestRender();
	}

	toggleFocus(): void {
		if (!this.overlay) {
			return;
		}
		if (this.hidden) {
			this.setHidden(false);
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
		this.ctx.ui.setWidget(SURFACE_WIDGET, undefined);
		this.component?.dispose?.();
	}

	private handleInput(data: string): void {
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
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
		if (this.hidden || this.disposed) {
			return [];
		}
		this.pageSize = Math.max(
			1,
			Math.floor(((this.tui?.terminal?.rows ?? 24) - 6) / 2)
		);
		const lines = this.component?.render(width) ?? [];
		const view = panelViewport(
			lines,
			this.pageSize,
			this.scrollTop,
			this.followSelection
		);
		this.scrollTop = view.offset;
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
		return rendered;
	}
}
