import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const AskOptionSchema = Type.Object({
	value: Type.String({
		description: "Machine-readable value returned when this option is chosen",
	}),
	label: Type.String({
		description: "Option text, a few words",
	}),
	description: Type.Optional(
		Type.String({
			description: "One-line explanation of this option",
		})
	),
	recommended: Type.Optional(
		Type.Boolean({
			description: "Marks this option as your recommendation",
		})
	),
});

export const AskQuestionSchema = Type.Object({
	id: Type.String({
		description: "Stable key for this question's answer in the result",
	}),
	label: Type.Optional(
		Type.String({
			description:
				"Short name for the question, one or two words. Default: Q1, Q2, ...",
		})
	),
	prompt: Type.String({
		description: "The question to the user",
	}),
	context: Type.Optional(
		Type.String({
			description:
				"Material the user needs to answer: text, or the absolute path of a UTF-8 text file whose contents are shown instead.",
		})
	),
	type: Type.Optional(
		StringEnum(["single", "multi"] as const, {
			description:
				"`single` (default) accepts one option. `multi` accepts several.",
		})
	),
	options: Type.Array(AskOptionSchema, {
		description:
			"Choices for this question. The user can always type their own answer instead.",
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
			description: "Short title for the whole set of questions",
		})
	),
	questions: Type.Array(AskQuestionSchema, {
		description: "Questions to ask together",
	}),
});

export const AskBackgroundOnlyParamsSchema = Type.Omit(AskParamsSchema, [
	"background",
]);
