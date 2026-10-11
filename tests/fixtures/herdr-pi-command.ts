#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const session = process.env.ASK_HERDR_TARGET_SESSION;
const pane = process.env.ASK_HERDR_TARGET_PANE;
if (!(session && pane)) {
	throw new Error("The native Herdr test requires an owned session and pane");
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// Forward the generated test configuration, not the caller's Herdr identity or credentials.
const environment = Object.entries(process.env)
	.filter(
		([name, value]) =>
			value !== undefined &&
			(name.startsWith("PI_INTEGRATION_TEST_") ||
				name === "PI_CODING_AGENT_DIR" ||
				name === "NODE_OPTIONS" ||
				name === "ASK_HERDR_SAVED_SESSION")
	)
	.map(([name, value]) => `${name}=${quote(value ?? "")}`);
const args = process.argv.slice(2);
if (process.env.ASK_HERDR_RESUME_SESSION) {
	args.unshift("--session", process.env.ASK_HERDR_RESUME_SESSION);
}
execFileSync(
	"herdr",
	[
		"--session",
		session,
		"pane",
		"run",
		pane,
		[...environment, "exec pi", ...args.map(quote)].join(" "),
	],
	{ stdio: "ignore" }
);
// PiIntegrationTest watches the real harness trace and owns this adapter's PTY lifetime.
// The native Pi pane is cleaned up separately by the named-server fixture.
process.stdin.resume();
