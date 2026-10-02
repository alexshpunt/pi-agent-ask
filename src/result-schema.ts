import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { AskOptionSchema, AskQuestionSchema } from "./schema.ts";

const AnswerSchema = Type.Object({
	values: Type.Array(Type.String()),
	labels: Type.Array(Type.String()),
	indices: Type.Array(Type.Integer({ minimum: 1 })),
	customText: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
	optionNotes: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const QuestionSummarySchema = Type.Object({
	id: Type.String(),
	label: Type.String(),
	prompt: Type.String(),
	type: StringEnum(["single", "multi", "preview"] as const),
	presentedType: AskQuestionSchema.properties.type,
});

const ElaborationQuestionSchema = Type.Object({
	...QuestionSummarySchema.properties,
	options: Type.Array(AskOptionSchema),
});

const ElaborationContext = {
	question: ElaborationQuestionSchema,
	answered: Type.Boolean(),
	answer: Type.Optional(AnswerSchema),
	note: Type.String(),
};

/** Structured ask result returned to Codemode; matches the tool's result details. */
export const AskResultSchema = Type.Object({
	title: Type.Optional(Type.String()),
	cancelled: Type.Boolean(),
	mode: StringEnum(["submit", "elaborate"] as const),
	questions: Type.Array(QuestionSummarySchema),
	answers: Type.Record(Type.String(), AnswerSchema),
	error: Type.Optional(
		Type.Object({
			kind: Type.Literal("invalid_input"),
			issues: Type.Array(
				Type.Object({ path: Type.String(), message: Type.String() })
			),
		})
	),
	continuation: Type.Optional(
		Type.Object({
			strategy: StringEnum(["refine_only", "resume"] as const),
			affectedQuestionIds: Type.Array(Type.String()),
			preservedAnswers: Type.Record(Type.String(), AnswerSchema),
			questionStates: Type.Record(
				Type.String(),
				Type.Object({
					status: StringEnum([
						"answered",
						"needs_clarification",
						"unanswered",
					] as const),
				})
			),
		})
	),
	elaboration: Type.Optional(
		Type.Object({
			instruction: Type.String(),
			nextAction: StringEnum(["clarify", "clarify_then_reask"] as const),
			items: Type.Array(
				Type.Union([
					Type.Object({
						...ElaborationContext,
						target: Type.Object({ kind: Type.Literal("question") }),
					}),
					Type.Object({
						...ElaborationContext,
						target: Type.Object({
							kind: Type.Literal("option"),
							optionValue: Type.String(),
						}),
						option: AskOptionSchema,
						selected: Type.Boolean(),
					}),
				])
			),
		})
	),
});
