import { StringEnum as piStringEnum } from "@earendil-works/pi-ai";
import { type TUnsafe, Type } from "typebox";

/**
 * pi-ai's string enum (`{ type: "string", enum: [...] }`, which every provider accepts) typed as a TypeBox schema, so it
 * nests inside `Type.Object` and infers through TypeBox's `Static`. Since pi-ai 1.5 its main entry types it with
 * pi-schema instead.
 */
export function StringEnum<const T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] }
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>(piStringEnum(values, options));
}
