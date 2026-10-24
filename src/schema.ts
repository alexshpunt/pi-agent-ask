import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const AskOptionSchema = Type.Object({
	value: Type.String({
		description: "Machine-readable value returned when this option is chosen",
	}),
	label: Type.String({
		description: "Short option text shown in the list",
	}),
	description: Type.Optional(
		Type.String({
			description: "One-line explanation shown with the option",
		})
	),
	preview: Type.Optional(
		Type.String({
			description:
				'Text shown in the preview pane while this option is focused. Used by `type: "preview"` questions.',
		})
	),
	previewFile: Type.Optional(
		Type.String({
			description:
				"Local UTF-8 text file shown in the preview pane instead of `preview`. Absolute or relative to Pi's working directory. Do not combine with `preview`.",
		})
	),
	recommended: Type.Optional(
		Type.Boolean({
			description: "Marks the option as recommended in the form",
		})
	),
});

export const AskQuestionSchema = Type.Object({
	id: Type.String({
		description: "Stable key for this question's answer in the result",
	}),
	label: Type.Optional(
		Type.String({
			description: "Short tab label. Default: Q1, Q2, ...",
		})
	),
	prompt: Type.String({
		description: "Question text shown to the user",
	}),
	type: Type.Optional(
		StringEnum(["single", "multi", "preview"] as const, {
			description:
				"`single` (default) accepts one option. `multi` accepts several. `preview` accepts one and shows the focused option's `preview` or `previewFile` beside the list; every option needs one of them.",
		})
	),
	options: Type.Array(AskOptionSchema, {
		description:
			"Choices for this question. The form always adds a free-text `Type your own` option.",
	}),
});

export const AskParamsSchema = Type.Object({
	background: Type.Optional(
		Type.Boolean({
			description:
				"Set true when the answer is not urgent and you have other work to do meanwhile. The form is queued and a request ID returns immediately; answers arrive later as a background-answer message or from wait_for_answers. Omit it only when the question is important and needs the user's answer right away; the call then waits for the answer.",
		})
	),
	title: Type.Optional(
		Type.String({
			description: "Short title shown above the form",
		})
	),
	questions: Type.Array(AskQuestionSchema, {
		description: "Questions shown as tabs in one form",
	}),
});

export const AskBackgroundOnlyParamsSchema = Type.Omit(AskParamsSchema, [
	"background",
]);
