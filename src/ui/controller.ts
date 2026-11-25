import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	matchesKey,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import type { AskDraft } from "../ask-draft.ts";
import {
	type AskSurfaceReservation,
	reserveAskSurface,
} from "../ask-surface.ts";
import { invalidPayloadResponse } from "../ask-tool-helpers.ts";
import type { AskEvents } from "../blocked-status.ts";
import { readClipboardImage } from "../clipboard-image.ts";
import type { AskConfig } from "../config/schema.ts";
import { getAskConfigStore } from "../config/store.ts";
import { resolveContextFiles } from "../context-files.ts";
import { beginUserWait } from "../herdr-wait-state.ts";
import {
	createQuestionWaitingNotification,
	notifyQuestionWaiting,
} from "../notifications.ts";
import { bindQuestionTerminal } from "../program-status.ts";
import {
	applyRemoteAskResponse,
	type RemoteAskFlowHandle,
	type RemoteAskResponse,
	type RemoteAskRuntime,
	type RemoteAskSource,
	type RemoteAskSubmitResolution,
} from "../remote-ask.ts";
import { createInitialState } from "../state/create.ts";
import {
	getEditorDraft,
	getEditorImages,
	saveEditorDraft,
	setEditorImages,
	submitEditorDraft,
	syncStateToSelection,
} from "../state/editor.ts";
import { cycleCurrentQuestionType } from "../state/question-type.ts";
import { toAskResult } from "../state/result.ts";
import {
	getCurrentOption,
	getCurrentQuestion,
	isSubmitTab,
} from "../state/selectors.ts";
import { skipCurrentQuestion } from "../state/skip.ts";
import {
	applyNumberShortcut,
	cancelFlow,
	confirmCurrentSelection,
	dismissFlow,
	enterOptionNoteMode,
	enterQuestionNoteMode,
	enterSubmitNoteMode,
	moveOption,
	moveTab,
	toggleCurrentMultiOption,
} from "../state/transitions.ts";
import { isEditingView } from "../state/view.ts";
import type { AskParams, AskResult, AskState } from "../types.ts";
import { maybeAutoSubmitState } from "./auto-submit.ts";
import { createAskAutocompleteProvider } from "./autocomplete.ts";
import {
	DIRTY_DISMISS_NOTICE,
	shouldConfirmDirtyDismiss,
	shouldDiscardAfterConfirmation,
} from "./dismiss-guard.ts";
import {
	beginFormRender,
	createFormScroll,
	endFormRender,
	type FormScroll,
	fitToScreen,
	scrollFormPage,
	scrollFormWheel,
} from "./form-scroll.ts";
import type { AskInputCommand } from "./input.ts";
import { getInputCommand } from "./input.ts";
import { backgroundPanelRows, foregroundFormRows } from "./panel-viewport.ts";
import {
	type PersistentAskOptions,
	showPersistentAsk,
} from "./persistent-ask.ts";
import { renderAskScreen } from "./render.ts";
import type { AskMouseTarget } from "./render-types.ts";
import {
	getReviewShortcutHint,
	resolveReviewShortcutDoublePress,
} from "./review-shortcuts.ts";
import { showAskSettings } from "./show-settings.ts";
import { waitForOverlay } from "./wait-for-overlay.ts";

type CustomCallback = Parameters<ExtensionContext["ui"]["custom"]>[0];
type CustomCallbackArgs = CustomCallback extends (...args: infer T) => unknown
	? T
	: never;
type Tui = CustomCallbackArgs[0];
type Theme = CustomCallbackArgs[1];
type Keybindings = CustomCallbackArgs[2];
type Done = (result: AskResult) => void;

interface AskFlowOptions {
	abortOnCancel?: boolean;
	background?: PersistentAskOptions & {
		draft?: AskDraft;
		onDefer(): void;
		onDraft(draft: AskDraft): void;
	};
	herdrEvents?: AskEvents;
	presentSingleAsMulti?: boolean;
	remote?: {
		runtime: RemoteAskRuntime;
		source: RemoteAskSource;
		toolCallId?: string;
	};
	signal?: AbortSignal;
	surface?: AskSurfaceReservation;
}

type AskFlowParams = AskParams &
	Pick<ExtensionContext, "cwd"> & {
		config: AskConfig;
		configNotice?: string;
		ctx: ExtensionContext;
		flowOptions: AskFlowOptions;
	};

interface AskFlowController {
	abortOnCancel: boolean;
	clipboardNotice?: string;
	clipboardReading: boolean;
	config: AskConfig;
	configNotice?: string;
	ctx: ExtensionContext;
	dismissNotice?: string;
	disposed: boolean;
	done: Done;
	editor: Editor;
	flowOptions: AskFlowOptions;
	keybindings: Keybindings;
	mouseTargets: AskMouseTarget[];
	pendingQuestionTypeChangeQuestionId?: string;
	pendingReviewShortcutActionIndex?: number;
	remoteFlow?: RemoteAskFlowHandle;
	/** Scroll positions of the context pane and, in the foreground, the whole form. */
	scroll: FormScroll;
	settingsOpen: boolean;
	state: AskState;
	suppressAutoInputForSelection: boolean;
	theme: Theme;
	tui: Tui;
	unsubscribeConfig: () => void;
}

export function runAskFlow(
	ctx: ExtensionContext,
	input: AskParams,
	options: AskFlowOptions = {}
): Promise<AskResult> {
	const run = () => runAskFlowOnSurface(ctx, input, options);
	if (ctx.mode !== "tui" || options.background) {
		return run();
	}
	return (options.surface ?? reserveAskSurface()).run(options.signal, run);
}

async function runAskFlowOnSurface(
	ctx: ExtensionContext,
	input: AskParams,
	options: AskFlowOptions
): Promise<AskResult> {
	const resolved = await resolveContextFiles(input);
	if (!resolved.ok) {
		return invalidPayloadResponse(input, resolved.issues).details;
	}
	const params = resolved.params;
	const store = getAskConfigStore();
	const { config, notice } = await store.ensureLoaded();
	const flowOptions = {
		...options,
		presentSingleAsMulti:
			options.presentSingleAsMulti ?? config.behaviour.presentSingleAsMulti,
	};
	if (ctx.mode !== "tui") {
		return {
			...toAskResult(createInitialState(params, flowOptions)),
			cancelled: true,
		};
	}
	const run = async () => {
		if (options.signal?.aborted) {
			throw new DOMException("Question form interrupted", "AbortError");
		}
		if (!options.background) {
			ctx.ui.setWorkingVisible(false);
		}
		const endWait = options.background
			? undefined
			: beginUserWait(options.herdrEvents, "Waiting for user response");
		try {
			const factory = (...args: [Tui, Theme, Keybindings, Done]) =>
				createAskFlowController(args, {
					...params,
					config,
					configNotice: notice?.text,
					cwd: ctx.cwd,
					ctx,
					flowOptions,
				});
			return options.background
				? await showPersistentAsk(ctx, factory, {
						...options.background,
						signal: options.signal,
					})
				: await ctx.ui.custom<AskResult>((...args) => {
						const wait = waitForOverlay(ctx.ui, args[0], options.signal);
						return wait ? wait.then(() => factory(...args)) : factory(...args);
					});
		} finally {
			if (!options.background) {
				ctx.ui.setWorkingVisible(true);
			}
			endWait?.();
		}
	};
	return run();
}

function createAskFlowController(
	[tui, theme, keybindings, done]: [
		Tui,
		Theme,
		Keybindings,
		(result: AskResult) => void,
	],
	params: AskFlowParams
) {
	bindQuestionTerminal(
		params.flowOptions.herdrEvents,
		tui.terminal,
		params.ctx
	);
	const controller: AskFlowController = {
		scroll: createFormScroll(),
		mouseTargets: [],
		abortOnCancel:
			params.flowOptions.abortOnCancel ??
			!(params.flowOptions.background || params.background),
		clipboardReading: false,
		disposed: false,
		keybindings,
		config: params.config,
		configNotice: params.configNotice,
		ctx: params.ctx,
		dismissNotice: undefined,
		done,
		editor: createEditor(tui, theme, params.cwd),
		flowOptions: params.flowOptions,
		settingsOpen: false,
		state:
			params.flowOptions.background?.draft?.state ??
			createInitialState(params, params.flowOptions),
		suppressAutoInputForSelection: false,
		pendingQuestionTypeChangeQuestionId: undefined,
		pendingReviewShortcutActionIndex: undefined,
		theme,
		tui,
		unsubscribeConfig: () => {
			// replaced immediately after controller creation
		},
	};

	controller.unsubscribeConfig = getAskConfigStore().subscribe((config) => {
		controller.config = config;
		controller.configNotice = undefined;
		controller.state = maybeAutoSubmitState(
			controller.state,
			controller.config
		);
		refresh(controller);
		maybeFinish(controller);
	});

	const abort = () => {
		controller.state = cancelFlow(controller.state);
		controller.done(toAskResult(controller.state));
	};
	params.flowOptions.signal?.addEventListener("abort", abort, { once: true });
	if (params.flowOptions.signal?.aborted) {
		abort();
	}
	controller.editor.onSubmit = (value) => submitEditor(controller, value);
	controller.remoteFlow = startRemoteFlow(controller, params);
	if (params.flowOptions.background?.draft) {
		controller.editor.setText(params.flowOptions.background.draft.editorText);
	} else {
		syncSelection(controller);
	}
	notifyCurrentQuestion(controller).catch(() => {
		// Notification failures are best-effort and must not affect the ask flow.
	});

	return createFlowComponent(controller, () => {
		params.flowOptions.signal?.removeEventListener("abort", abort);
	});
}

function createFlowComponent(
	controller: AskFlowController,
	onDispose: () => void
) {
	return {
		// Fullscreen hosts then route PgUp/PgDn here instead of scrolling the transcript.
		capturesViewportInput: true,
		scrollPage: (direction: -1 | 1) => scrollPage(controller, direction),
		get focused() {
			return controller.editor.focused;
		},
		set focused(value: boolean) {
			controller.editor.focused = value;
		},
		render: (width: number) => renderController(controller, width),
		invalidate() {
			controller.editor.invalidate();
		},
		handleInput(data: string) {
			handleControllerInput(controller, data);
		},
		handleMouse(event: TuiMouseEvent) {
			return handleControllerMouse(controller, event);
		},
		dispose() {
			controller.disposed = true;
			onDispose();
			controller.remoteFlow?.dispose();
			controller.unsubscribeConfig();
		},
	};
}

function renderController(
	controller: AskFlowController,
	width: number
): string[] {
	controller.mouseTargets = [];
	beginFormRender(controller.scroll, controller.state.activeTabIndex);
	const background = !!controller.flowOptions.background;
	const terminalRows = controller.tui.terminal?.rows ?? 24;
	const maxRows = background
		? backgroundPanelRows(terminalRows)
		: foregroundFormRows(terminalRows);
	const lines = renderAskScreen({
		targets: controller.mouseTargets,
		config: controller.config,
		background,
		contextOffset: controller.scroll.contextOffset,
		editor: controller.editor,
		footerNotice: getFooterNotice(controller),
		layout: controller.scroll.layout,
		maxRows,
		reviewShortcutHint: getActiveReviewShortcutHint(controller),
		state: controller.state,
		theme: controller.theme,
		width,
	});
	endFormRender(controller.scroll);
	// A background panel scrolls its own frame; a foreground form owns the screen.
	return background
		? lines
		: fitToScreen({
				columns: width,
				lines,
				maxRows,
				scroll: controller.scroll,
				state: controller.state,
				targets: controller.mouseTargets,
				theme: controller.theme,
			});
}

function scrollPage(controller: AskFlowController, direction: -1 | 1): boolean {
	const moved = scrollFormPage(controller.scroll, {
		background: !!controller.flowOptions.background,
		direction,
		terminalRows: controller.tui.terminal?.rows ?? 24,
	});
	if (moved) {
		controller.tui.requestRender();
	}
	return moved;
}

function handleControllerMouse(
	controller: AskFlowController,
	event: TuiMouseEvent
): TuiMouseEventResult | undefined {
	const inactive =
		controller.disposed ||
		controller.settingsOpen ||
		controller.state.completed;
	if (event.type === "wheel") {
		return inactive
			? undefined
			: scrollFormWheel(
					controller.scroll,
					event,
					!!controller.flowOptions.background
				);
	}
	if (
		inactive ||
		event.button !== "left" ||
		event.shift ||
		event.alt ||
		event.ctrl ||
		(event.type !== "press" && event.type !== "click")
	) {
		return;
	}
	const target = controller.mouseTargets.find(
		(item) =>
			event.x >= item.x &&
			event.x < item.x + item.width &&
			event.y >= item.y &&
			event.y < item.y + item.height
	);
	if (!target) {
		return;
	}
	if (event.type === "press") {
		return { handled: true, render: false };
	}
	clickTarget(controller, target);
	return { handled: true };
}

function clickTarget(controller: AskFlowController, target: AskMouseTarget) {
	if (target.kind === "tab") {
		let next = saveEditorState(controller);
		while (next.activeTabIndex !== target.index) {
			next = moveTab(next, 1);
		}
		clearReviewShortcutPending(controller);
		clearQuestionTypeChangePending(controller);
		commitState(controller, next);
	} else if (target.kind === "submit") {
		if (!handleReviewShortcutNumber(controller, target.index + 1)) {
			commitState(
				controller,
				applyNumberShortcut(controller.state, target.index + 1),
				{ finish: true }
			);
		}
	} else {
		clearReviewShortcutPending(controller);
		clearQuestionTypeChangePending(controller);
		commitState(
			controller,
			applyNumberShortcut(saveEditorState(controller), target.index + 1),
			{ finish: true }
		);
	}
}

/** A foreground form scrolls itself; a background panel receives `PgUp`/`PgDn` first. */
function handlePageKey(controller: AskFlowController, data: string): boolean {
	if (controller.flowOptions.background) {
		return false;
	}
	if (matchesKey(data, "pageUp")) {
		return scrollPage(controller, -1);
	}
	return matchesKey(data, "pageDown") && scrollPage(controller, 1);
}

/** Keys only a background panel owns: `Esc` defers all questions, `D` skips one. */
function handleBackgroundKey(
	controller: AskFlowController,
	data: string
): boolean {
	const background = controller.flowOptions.background;
	if (!background) {
		return false;
	}
	if (matchesKey(data, "esc")) {
		refresh(controller);
		background.onDefer();
		return true;
	}
	if (!isEditingView(controller.state) && matchesKey(data, "d")) {
		commitState(controller, skipCurrentQuestion(controller.state));
		return true;
	}
	return false;
}

function handleControllerInput(controller: AskFlowController, data: string) {
	if (handlePageKey(controller, data)) {
		return;
	}
	controller.scroll.followView = true;
	if (handleBackgroundKey(controller, data)) {
		return;
	}
	controller.editor.disableSubmit = !isNativeEditorSubmitEnabled(controller);
	const command = getInputCommand(
		controller.state,
		controller.config,
		data,
		isEditingView(controller.state) ? controller.editor.getText() : ""
	);
	if (isEditingView(controller.state)) {
		handleEditingInput(controller, command, data);
		return;
	}
	handleNavigationCommand(controller, command);
}

function handleEditingInput(
	controller: AskFlowController,
	command: AskInputCommand,
	data: string
) {
	if (command.kind === "delegateToEditor") {
		if (controller.keybindings.matches(data, "app.clipboard.pasteImage")) {
			pasteImage(controller);
			return;
		}
		if (
			matchesKey(data, "ctrl+alt+d") &&
			getEditorImages(controller.state).length
		) {
			controller.state = setEditorImages(
				controller.state,
				getEditorImages(controller.state).slice(0, -1)
			);
			refresh(controller);
			return;
		}
	}
	handleEditingCommand(controller, command, data);
}

function isPasteTarget(
	controller: AskFlowController,
	view: AskState["view"]
): boolean {
	return (
		!(controller.disposed || controller.state.completed) &&
		controller.state.view === view
	);
}
function clipboardErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
async function pasteImage(controller: AskFlowController): Promise<void> {
	if (controller.state.view.kind === "submit-note") {
		controller.clipboardNotice = "Final action comments support text only.";
		refresh(controller);
		return;
	}
	if (controller.clipboardReading) {
		return;
	}
	const view = controller.state.view;
	controller.clipboardReading = true;
	controller.clipboardNotice = "Reading image clipboard…";
	refresh(controller);
	try {
		const image = await readClipboardImage();
		if (!isPasteTarget(controller, view)) {
			return;
		}
		controller.clipboardNotice = image
			? undefined
			: "No image in the clipboard.";
		if (image) {
			controller.state = setEditorImages(controller.state, [
				...getEditorImages(controller.state),
				image,
			]);
		}
	} catch (error) {
		if (isPasteTarget(controller, view)) {
			controller.clipboardNotice = clipboardErrorMessage(error);
		}
	} finally {
		controller.clipboardReading = false;
		if (!isPasteTarget(controller, view)) {
			controller.clipboardNotice = undefined;
		}
		if (!controller.disposed) {
			refresh(controller);
		}
	}
}
function isNativeEditorSubmitEnabled(controller: AskFlowController): boolean {
	if (controller.state.view.kind === "input") {
		return controller.config.keymaps.editor.submit.includes("enter");
	}
	if (
		controller.state.view.kind === "note" ||
		controller.state.view.kind === "submit-note"
	) {
		return controller.config.keymaps.noteEditor.save.includes("enter");
	}
	return true;
}

function handleEditingCommand(
	controller: AskFlowController,
	command: AskInputCommand,
	data: string
) {
	if (command.kind === "dismiss") {
		handleExitFlow(controller, dismissFlow(controller.state));
		return;
	}
	if (command.kind === "showSettings") {
		showSettingsModal(controller);
		return;
	}
	if (command.kind === "editMoveTab") {
		commitSavedEditorNavigation(controller, moveTab, command.delta);
		return;
	}
	if (command.kind === "editMoveOption") {
		commitSavedEditorNavigation(controller, moveOption, command.delta);
		return;
	}
	if (command.kind === "editClose") {
		closeEditor(controller);
		return;
	}
	if (command.kind === "editSubmit") {
		submitEditor(controller, controller.editor.getText());
		return;
	}
	if (command.kind === "delegateToEditor") {
		controller.editor.handleInput(data);
		refresh(controller);
	}
}

function handleNavigationCommand(
	controller: AskFlowController,
	command: AskInputCommand
) {
	switch (command.kind) {
		case "moveTab":
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			commitState(controller, moveTab(controller.state, command.delta));
			return;
		case "moveOption":
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			commitState(controller, moveOption(controller.state, command.delta));
			return;
		case "toggleMulti":
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			handleToggleCurrentOption(controller);
			return;
		case "changeQuestionType":
			clearReviewShortcutPending(controller);
			handleChangeQuestionType(controller);
			return;
		case "openQuestionNote":
			clearQuestionTypeChangePending(controller);
			openQuestionNote(controller);
			return;
		case "openOptionNote":
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			openOptionNote(controller);
			return;
		case "confirm":
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			commitState(controller, confirmCurrentSelection(controller.state), {
				finish: true,
			});
			return;
		case "cancel":
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			handleExitFlow(controller, cancelFlow(controller.state));
			return;
		case "numberShortcut":
			if (handleReviewShortcutNumber(controller, command.digit)) {
				return;
			}
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			commitState(
				controller,
				applyNumberShortcut(controller.state, command.digit)
			);
			return;
		case "dismiss":
			clearReviewShortcutPending(controller);
			clearQuestionTypeChangePending(controller);
			handleExitFlow(controller, dismissFlow(controller.state));
			return;
		case "showSettings":
			showSettingsModal(controller);
			return;
		case "ignore":
		case "editMoveTab":
		case "editMoveOption":
		case "editClose":
		case "editSubmit":
		case "delegateToEditor":
			return;
		default:
			return;
	}
}

function handleToggleCurrentOption(controller: AskFlowController) {
	const question = getCurrentQuestion(controller.state);
	if (!question) {
		return;
	}
	commitState(controller, toggleCurrentMultiOption(controller.state));
}

function handleChangeQuestionType(controller: AskFlowController) {
	const question = getCurrentQuestion(controller.state);
	if (!question || isSubmitTab(controller.state)) {
		return;
	}
	const confirmed =
		controller.pendingQuestionTypeChangeQuestionId === question.id;
	const result = cycleCurrentQuestionType(controller.state, { confirmed });
	controller.dismissNotice = result.notice;
	if (result.needsConfirmation) {
		controller.pendingQuestionTypeChangeQuestionId = question.id;
		refresh(controller);
		return;
	}
	clearQuestionTypeChangePending(controller);
	commitState(controller, result.state, { finish: true });
}

function openQuestionNote(controller: AskFlowController) {
	const question = getCurrentQuestion(controller.state);
	if (!question || isSubmitTab(controller.state)) {
		return;
	}
	commitState(
		controller,
		enterQuestionNoteMode(controller.state, question.id),
		{
			syncSelection: false,
		}
	);
}

function openOptionNote(controller: AskFlowController) {
	if (isSubmitTab(controller.state)) {
		commitState(controller, enterSubmitNoteMode(controller.state), {
			syncSelection: false,
		});
		return;
	}
	const question = getCurrentQuestion(controller.state);
	const option = getCurrentOption(controller.state);
	if (
		!(question && option) ||
		option.isCustomOption ||
		isSubmitTab(controller.state)
	) {
		return;
	}
	commitState(
		controller,
		enterOptionNoteMode(controller.state, question.id, option.value),
		{ syncSelection: false }
	);
}

function commitState(
	controller: AskFlowController,
	nextState: AskState,
	options: { finish?: boolean; syncSelection?: boolean } = {}
) {
	if (nextState.activeTabIndex !== controller.state.activeTabIndex) {
		clearFooterNotices(controller);
	}
	controller.suppressAutoInputForSelection = false;
	controller.state = nextState;
	if (options.syncSelection !== false) {
		syncSelection(controller);
	}
	controller.state = maybeAutoSubmitState(controller.state, controller.config);
	hydrateEditor(controller);
	refresh(controller);
	if (options.finish) {
		maybeFinish(controller);
	}
}

function submitEditor(controller: AskFlowController, value: string) {
	controller.suppressAutoInputForSelection = false;
	const nextState = submitEditorDraft(controller.state, value);
	if (nextState.activeTabIndex !== controller.state.activeTabIndex) {
		clearFooterNotices(controller);
	}
	controller.state = nextState;
	syncSelection(controller);
	controller.state = maybeAutoSubmitState(controller.state, controller.config);
	hydrateEditor(controller);
	refresh(controller);
	maybeFinish(controller);
}

function commitSavedEditorNavigation(
	controller: AskFlowController,
	navigate: (state: AskState, delta: 1 | -1) => AskState,
	delta: 1 | -1
) {
	commitState(controller, navigate(saveEditorState(controller), delta));
}

function closeEditor(controller: AskFlowController) {
	const nextState = saveEditorState(controller);
	controller.suppressAutoInputForSelection = nextState.view.kind !== "input";
	controller.state = nextState;
	refresh(controller);
}

function handleExitFlow(controller: AskFlowController, nextState: AskState) {
	if (!shouldRequestDismissConfirmation(controller)) {
		commitState(controller, nextState, { finish: true });
		return;
	}
	if (shouldDiscardAfterConfirmation(!!controller.dismissNotice)) {
		commitState(controller, nextState, { finish: true });
		return;
	}
	controller.dismissNotice = DIRTY_DISMISS_NOTICE;
	refresh(controller);
}

function shouldRequestDismissConfirmation(
	controller: AskFlowController
): boolean {
	return shouldConfirmDirtyDismiss({
		config: controller.config,
		state: controller.state,
		editingText: isEditingView(controller.state)
			? controller.editor.getText()
			: "",
	});
}

function clearFooterNotices(controller: AskFlowController) {
	controller.configNotice = undefined;
	controller.dismissNotice = undefined;
	controller.clipboardNotice = undefined;
}

function clearReviewShortcutPending(controller: AskFlowController) {
	controller.pendingReviewShortcutActionIndex = undefined;
}

function clearQuestionTypeChangePending(controller: AskFlowController) {
	controller.pendingQuestionTypeChangeQuestionId = undefined;
}

function getActiveReviewShortcutHint(
	controller: AskFlowController
): string | undefined {
	if (
		!(
			isSubmitTab(controller.state) &&
			controller.config.behaviour.doublePressReviewShortcuts
		)
	) {
		return;
	}
	return getReviewShortcutHint(controller.pendingReviewShortcutActionIndex);
}

function handleReviewShortcutNumber(
	controller: AskFlowController,
	digit: number
): boolean {
	if (
		!(
			isSubmitTab(controller.state) &&
			controller.config.behaviour.doublePressReviewShortcuts
		)
	) {
		return false;
	}

	const resolution = resolveReviewShortcutDoublePress(
		digit,
		controller.pendingReviewShortcutActionIndex
	);
	if (resolution.actionIndex === undefined) {
		return false;
	}

	controller.pendingReviewShortcutActionIndex = resolution.pendingActionIndex;
	const nextState = resolution.confirmed
		? applyNumberShortcut(controller.state, digit)
		: {
				...controller.state,
				activeSubmitActionIndex: resolution.actionIndex,
			};
	commitState(controller, nextState, { finish: resolution.confirmed });
	return true;
}

function getFooterNotice(controller: AskFlowController): string | undefined {
	const notice =
		controller.clipboardNotice ??
		controller.dismissNotice ??
		controller.configNotice;
	if (
		!isEditingView(controller.state) ||
		controller.state.view.kind === "submit-note"
	) {
		return notice;
	}
	const keys = controller.keybindings
		.getKeys("app.clipboard.pasteImage")
		.join("/");
	const hint = `${keys || "Paste image"}: attach image${getEditorImages(controller.state).length ? " · Ctrl+Alt+D: remove last image" : ""}`;
	return [notice, hint].filter(Boolean).join("\n");
}

function showSettingsModal(controller: AskFlowController) {
	if (controller.settingsOpen) {
		return;
	}
	controller.settingsOpen = true;
	showAskSettings(controller.ctx).finally(() => {
		controller.settingsOpen = false;
		refresh(controller);
	});
}

function refresh(controller: AskFlowController) {
	controller.mouseTargets = [];
	controller.flowOptions.background?.onDraft({
		state: controller.state,
		editorText: controller.editor.getText(),
	});
	controller.tui.requestRender();
}

async function notifyCurrentQuestion(
	controller: AskFlowController
): Promise<void> {
	const question = getCurrentQuestion(controller.state);
	if (!question) {
		return;
	}
	await notifyQuestionWaiting(
		controller.config,
		createQuestionWaitingNotification(question)
	);
}

function maybeFinish(controller: AskFlowController) {
	if (controller.state.completed) {
		const result = toAskResult(controller.state);
		controller.remoteFlow?.complete(result);
		controller.done(result);
		if (result.cancelled && !result.comment && controller.abortOnCancel) {
			controller.ctx.abort();
		}
	}
}

function startRemoteFlow(
	controller: AskFlowController,
	params: AskFlowParams
): RemoteAskFlowHandle | undefined {
	const remote = params.flowOptions.remote;
	if (!remote) {
		return;
	}
	return remote.runtime.startFlow({
		source: remote.source,
		toolCallId: remote.toolCallId,
		title: controller.state.title,
		questions: controller.state.questions,
		onSubmit: (response) => submitRemoteResponse(controller, response),
	});
}

function submitRemoteResponse(
	controller: AskFlowController,
	response: RemoteAskResponse
): RemoteAskSubmitResolution {
	const resolution = applyRemoteAskResponse(controller.state, response);
	if (!resolution.ok) {
		return resolution;
	}
	commitState(controller, resolution.state, { finish: true });
	return { ok: true };
}

function hydrateEditor(controller: AskFlowController) {
	controller.editor.setText(getEditorDraft(controller.state));
}

function syncSelection(controller: AskFlowController) {
	if (controller.suppressAutoInputForSelection) {
		return;
	}
	controller.state = syncStateToSelection(controller.state);
}

function saveEditorState(controller: AskFlowController): AskState {
	const text = controller.editor.getText();
	controller.editor.setText("");
	return saveEditorDraft(controller.state, text);
}

function createEditor(tui: Tui, theme: Theme, cwd: string) {
	const editor = new Editor(tui, createEditorTheme(theme));
	editor.setAutocompleteProvider(createAskAutocompleteProvider(cwd));
	return editor;
}

function createEditorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("accent", text),
		selectList: {
			description: (text) => theme.fg("muted", text),
			noMatch: (text) => theme.fg("warning", text),
			scrollInfo: (text) => theme.fg("dim", text),
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
		},
	};
}
