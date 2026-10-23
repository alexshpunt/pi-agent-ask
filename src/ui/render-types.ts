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

export interface QuestionRenderContext {
	editor: Editor;
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
