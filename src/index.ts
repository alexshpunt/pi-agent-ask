import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskHistoryTools } from "./ask-history-tools.ts";
import { AskModeController } from "./ask-mode.ts";
import { registerAskModeCommand } from "./ask-mode-command.ts";
import { registerAskSettingsCommand } from "./ask-settings-command.ts";
import { registerAskTool } from "./ask-tool.ts";
import { registerBackgroundAnswerRenderer } from "./background-answer.ts";
import { createBackgroundAskRuntime } from "./background-ask.ts";
import { getAskConfigStore, resetAskConfigStore } from "./config/store.ts";
import { createRemoteAskRuntime } from "./remote-ask.ts";
import { registerPendingAskResume } from "./resume-pending-ask.ts";
import { registerWaitForAnswersTool } from "./wait-for-answers-tool.ts";

export default function askExtension(pi: ExtensionAPI) {
	resetAskConfigStore();
	const remoteAsk = createRemoteAskRuntime(pi.events);
	pi.on("session_shutdown", () => {
		remoteAsk.disposeAll();
	});
	const backgroundAsk = createBackgroundAskRuntime(pi, remoteAsk);
	registerBackgroundAnswerRenderer(pi);
	const mode = new AskModeController(getAskConfigStore(), (backgroundOnly) => {
		registerQuestionTools();
		if (backgroundOnly) {
			backgroundAsk.interruptWait(
				new Error(
					"wait_for_answers is unavailable in background-only mode. End your turn and receive answers asynchronously."
				)
			);
		}
	});
	const registerQuestionTools = () => {
		registerAskTool(pi, remoteAsk, backgroundAsk, () => mode.backgroundOnly);
		registerWaitForAnswersTool(pi, backgroundAsk, () => mode.backgroundOnly);
	};
	registerQuestionTools();
	pi.on("session_start", async (_event, ctx) => {
		await mode.initialize(ctx);
		if ((await getAskConfigStore().getConfig()).behaviour.historyTools) {
			registerAskHistoryTools(pi);
		}
	});
	pi.on("context", () => mode.markModelRequest());
	pi.on("session_shutdown", () => mode.endSession());
	registerAskModeCommand(pi, mode);
	registerAskSettingsCommand(pi);
	registerPendingAskResume(pi, remoteAsk);
}
