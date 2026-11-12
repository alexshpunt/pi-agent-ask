import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { StringEnum } from "../src/string-enum.ts";

test("StringEnum serializes as a plain string enum", () => {
	assert.deepEqual(JSON.parse(JSON.stringify(StringEnum(["a", "b"]))), {
		type: "string",
		enum: ["a", "b"],
	});
	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				StringEnum(["a", "b"], { description: "Pick one", default: "a" })
			)
		),
		{ type: "string", enum: ["a", "b"], description: "Pick one", default: "a" }
	);
});

test("StringEnum validates inside a TypeBox object", () => {
	const schema = Type.Object({ choice: StringEnum(["a", "b"]) });
	assert.equal(Value.Check(schema, { choice: "b" }), true);
	assert.equal(Value.Check(schema, { choice: "c" }), false);
});
