import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Editor } from "@earendil-works/pi-tui";
import type {
	getAnswer,
	getCurrentQuestion,
	getRenderableOptions,
} from "../state/selectors.ts";
import type { AskDisplayOption, AskState } from "../types.ts";

export type Theme = ExtensionContext["ui"]["theme"];

export interface AskMouseTarget {
	height: number;
	index: number;
	kind: "option" | "tab" | "submit";
	width: number;
	x: number;
	y: number;
}

/** Scrollable question context, in the rendered screen's coordinates. */
export interface AskContextPane {
	height: number;
	maxOffset: number;
	offset: number;
	width: number;
	x: number;
	y: number;
}

/** What a render reports back besides its lines. */
export interface AskRenderLayout {
	contextPane?: AskContextPane;
}

export interface QuestionRenderContext {
	/** Row budget for `lines`, which already hold the header; the footer is excluded. */
	availableRows?: number;
	/** Scroll offset of the context pane, in content rows. */
	contextOffset?: number;
	editor: Editor;
	layout?: AskRenderLayout;
	lines: string[];
	markActiveRow?: boolean;
	options: ReturnType<typeof getRenderableOptions>;
	question: NonNullable<ReturnType<typeof getCurrentQuestion>>;
	state: AskState;
	targets?: AskMouseTarget[];
	theme: Theme;
	width: number;
}

export interface OptionDetailRenderContext {
	answer: ReturnType<typeof getAnswer>;
	editor: Editor;
	lines: string[];
	option: AskDisplayOption | undefined;
	questionId: string;
	selected?: boolean;
	state: AskState;
	theme: Theme;
	width: number;
}
