export type AskQuestionType = "single" | "multi";

export interface AskOption {
	description?: string;
	label: string;
	recommended?: boolean;
	value: string;
}

export interface AskQuestionInput {
	/** Text shown with the question; a single-line absolute path is loaded as a UTF-8 file. */
	context?: string;
	id: string;
	label?: string;
	options: AskOption[];
	prompt: string;
	type?: AskQuestionType;
}

export interface AskParams {
	/** Queue the form without blocking agent work. Omit for a normal blocking interview. */
	background?: boolean;
	questions: AskQuestionInput[];
	title?: string;
}

export interface AskValidationIssue {
	message: string;
	path: string;
}

export interface AskValidationError {
	issues: AskValidationIssue[];
	kind: "invalid_input";
}

export interface AskQuestion extends Omit<AskQuestionInput, "type" | "label"> {
	label: string;
	presentedType?: AskQuestionType;
	requestedType?: AskQuestionType;
	type: AskQuestionType;
}

export interface AskSelectedOption {
	index: number;
	label: string;
	value: string;
}

/** A clipboard image stored with its answer so it survives session recovery. */
export interface AskImage {
	/** Base64 image bytes, without a data URI prefix. */
	data: string;
	id: string;
	mimeType: string;
}

export interface AskAnswerImages {
	customImages?: AskImage[];
	noteImages?: AskImage[];
	optionNoteImages?: Record<string, AskImage[]>;
}

export interface AskStateAnswer extends AskAnswerImages {
	customSelected?: boolean;
	customText?: string;
	note?: string;
	optionNotes?: Record<string, string>;
	selected: AskSelectedOption[];
}

export interface AskResultAnswer extends AskAnswerImages {
	customText?: string;
	indices: number[];
	labels: string[];
	note?: string;
	optionNotes?: Record<string, string>;
	values: string[];
}

export interface AskQuestionSummary {
	id: string;
	label: string;
	presentedType?: AskQuestionType;
	prompt: string;
	type: AskQuestionType;
}

export interface AskResult {
	answers: Record<string, AskResultAnswer>;
	cancelled: boolean;
	error?: AskValidationError;
	questions: AskQuestionSummary[];
	/** Stable journal request key for an ask_user tool call. */
	requestId?: string;
	/** Questions explicitly skipped by the user, never treated as answers. */
	skippedQuestionIds?: string[];
	title?: string;
}

export type ViewState =
	| { kind: "navigate" }
	| { kind: "submit" }
	| { kind: "input"; questionId: string }
	| { kind: "note"; questionId: string; optionValue?: string };

export interface SkippedQuestion {
	/** Position in the original questionnaire, before any skips. */
	index: number;
	question: AskQuestion;
}

export interface AskState {
	activeOptionIndex: number;
	activeSubmitActionIndex: number;
	activeTabIndex: number;
	answers: Record<string, AskStateAnswer>;
	cancelled: boolean;
	completed: boolean;
	questions: AskQuestion[];
	/** Removed from active navigation but retained for ordered result metadata. */
	skippedQuestions?: SkippedQuestion[];
	title?: string;
	view: ViewState;
}

export interface AskDisplayOption extends AskOption {
	isCustomOption?: boolean;
}

export type AskAction =
	| { type: "MOVE_TAB"; delta: 1 | -1 }
	| { type: "MOVE_OPTION"; delta: 1 | -1 }
	| { type: "OPEN_INPUT"; questionId: string }
	| { type: "OPEN_QUESTION_NOTE"; questionId: string }
	| { type: "OPEN_OPTION_NOTE"; questionId: string; optionValue: string }
	| { type: "CONFIRM" }
	| { type: "TOGGLE_MULTI" }
	| { type: "NUMBER_SHORTCUT"; digit: number }
	| { type: "SAVE_INPUT"; value: string; submit?: boolean }
	| { type: "SAVE_NOTE"; value: string }
	| { type: "CANCEL" };
