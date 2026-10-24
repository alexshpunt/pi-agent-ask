import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { AskQuestionSchema } from "./schema.ts";
import type { AskResult } from "./types.ts";

export const AskImageSchema = Type.Object({
	id: Type.String(),
	mimeType: Type.String(),
	data: Type.String(),
});
const ImageFields = {
	customImages: Type.Optional(Type.Array(AskImageSchema)),
	noteImages: Type.Optional(Type.Array(AskImageSchema)),
	optionNoteImages: Type.Optional(
		Type.Record(Type.String(), Type.Array(AskImageSchema))
	),
};

/** A submitted answer, including free text and saved notes. */
export const AnswerSchema = Type.Object({
	...ImageFields,
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
	type: StringEnum(["single", "multi"] as const),
	presentedType: AskQuestionSchema.properties.type,
});

/** Full ask result kept in tool details, history, and background answers. */
export const AskResultSchema = Type.Object({
	requestId: Type.Optional(Type.String()),
	title: Type.Optional(Type.String()),
	cancelled: Type.Boolean(),
	questions: Type.Array(QuestionSummarySchema),
	skippedQuestionIds: Type.Optional(Type.Array(Type.String())),
	answers: Type.Record(Type.String(), AnswerSchema),
	error: Type.Optional(
		Type.Object({
			kind: Type.Literal("invalid_input"),
			issues: Type.Array(
				Type.Object({ path: Type.String(), message: Type.String() })
			),
		})
	),
});

const OutputAnswerSchema = Type.Object({
	values: Type.Array(Type.String()),
	labels: Type.Array(Type.String()),
	customText: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
	optionNotes: Type.Optional(Type.Record(Type.String(), Type.String())),
	images: Type.Optional(
		Type.Array(Type.Object({ mimeType: Type.String(), data: Type.String() }))
	),
});

/** Compact answers returned to programmatic callers such as Codemode scripts. */
export const AskOutputSchema = Type.Object({
	requestId: Type.Optional(Type.String()),
	cancelled: Type.Boolean(),
	answers: Type.Record(Type.String(), OutputAnswerSchema),
	skippedQuestionIds: Type.Optional(Type.Array(Type.String())),
	error: Type.Optional(
		Type.Object({
			issues: Type.Array(
				Type.Object({ path: Type.String(), message: Type.String() })
			),
		})
	),
});

export type AskOutput = Static<typeof AskOutputSchema>;

/** Project a full result onto the compact output contract. */
export function toAskOutput(result: AskResult): AskOutput {
	const answers = Object.fromEntries(
		Object.entries(result.answers).map(([questionId, answer]) => {
			const images = [
				...(answer.customImages ?? []),
				...(answer.noteImages ?? []),
				...Object.values(answer.optionNoteImages ?? {}).flat(),
			].map(({ mimeType, data }) => ({ mimeType, data }));
			return [
				questionId,
				{
					values: answer.values,
					labels: answer.labels,
					...(answer.customText === undefined
						? {}
						: { customText: answer.customText }),
					...(answer.note === undefined ? {} : { note: answer.note }),
					...(answer.optionNotes ? { optionNotes: answer.optionNotes } : {}),
					...(images.length ? { images } : {}),
				},
			];
		})
	);
	return {
		...(result.requestId ? { requestId: result.requestId } : {}),
		cancelled: result.cancelled,
		answers,
		...(result.skippedQuestionIds?.length
			? { skippedQuestionIds: result.skippedQuestionIds }
			: {}),
		...(result.error ? { error: { issues: result.error.issues } } : {}),
	};
}
