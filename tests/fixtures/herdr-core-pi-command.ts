#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const addressFile = process.env.ASK_HERDR_ADDRESS_FILE;
if (!addressFile) {
	throw new Error("The core test requires an owned terminal address file");
}
// Forward only generated harness configuration, not the caller's terminal identity.
const environment = Object.entries(process.env)
	.filter(
		([name, value]) =>
			value !== undefined &&
			(name.startsWith("PI_INTEGRATION_TEST_") ||
				name === "PI_CODING_AGENT_DIR" ||
				name === "NODE_OPTIONS")
	)
	.map(([name, value]) => `${name}=${value}`);
const pi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const args = process.argv.slice(2);
if (process.env.ASK_HERDR_RESUME_SESSION) {
	args.unshift("--session", process.env.ASK_HERDR_RESUME_SESSION);
}
const result = JSON.parse(
	execFileSync(
		"hc",
		[
			"run",
			"--json",
			"--bg",
			"--no-parent",
			"--no-notify",
			"--cwd",
			process.cwd(),
			"/usr/bin/env",
			...environment,
			"ASK_HERDR_CORE=1",
			...(process.env.ASK_HERDR_SAVED_SESSION
				? [`ASK_HERDR_SAVED_SESSION=${process.env.ASK_HERDR_SAVED_SESSION}`]
				: []),
			pi,
			...args,
		],
		{ encoding: "utf8" }
	)
) as { address: string };
writeFileSync(addressFile, result.address);
// The test owns cleanup. Its harness watches Pi's actual trace, not this adapter's PTY.
process.stdin.resume();
