import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { convertToPng } from "@earendil-works/pi-coding-agent";
import { getNativeClipboard } from "@earendil-works/pi-tui";
import type { AskImage } from "./types.ts";

const execute = promisify(execFile);
const newline = /\r?\n/;
const formats = ["image/png", "image/jpeg", "image/webp", "image/gif"];

async function command(
	program: string,
	args: string[]
): Promise<Buffer | undefined> {
	try {
		const result = await execute(program, args, {
			encoding: "buffer",
			timeout: 5000,
			maxBuffer: 32 * 1024 * 1024,
		});
		return result.stdout;
	} catch {
		return;
	}
}

async function linuxClipboard(
	wayland: boolean
): Promise<AskImage | null | undefined> {
	const program = wayland ? "wl-paste" : "xclip";
	const types = await command(
		program,
		wayland
			? ["--list-types"]
			: ["-selection", "clipboard", "-t", "TARGETS", "-o"]
	);
	if (types === undefined) {
		return;
	}
	const available = types
		.toString()
		.split(newline)
		.map((type) => type.trim());
	const mimeType = formats.find((type) => available.includes(type));
	if (!mimeType) {
		return null;
	}
	const bytes = await command(
		program,
		wayland
			? ["--type", mimeType, "--no-newline"]
			: ["-selection", "clipboard", "-t", mimeType, "-o"]
	);
	if (bytes === undefined) {
		return;
	}
	return bytes.length
		? { id: randomUUID(), mimeType, data: bytes.toString("base64") }
		: null;
}

async function windowsClipboard(): Promise<AskImage | null | undefined> {
	const directory = await mkdtemp(join(tmpdir(), "pi-ask-clipboard-"));
	try {
		const path = join(directory, "image.png");
		const converted = await command("wslpath", ["-w", path]);
		if (!converted) {
			return;
		}
		const windowsPath = converted.toString().trim().replaceAll("'", "''");
		const script = [
			"Add-Type -AssemblyName System.Windows.Forms",
			"Add-Type -AssemblyName System.Drawing",
			"$image = [System.Windows.Forms.Clipboard]::GetImage()",
			`if ($image) { try { $image.Save('${windowsPath}', [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } finally { $image.Dispose() } } else { Write-Output 'empty' }`,
		].join("; ");
		const result = await command("powershell.exe", [
			"-NoProfile",
			"-STA",
			"-Command",
			script,
		]);
		if (result === undefined) {
			return;
		}
		if (result.toString().trim() !== "ok") {
			return null;
		}
		const bytes = await readFile(path);
		return {
			id: randomUUID(),
			mimeType: "image/png",
			data: bytes.toString("base64"),
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function readLinuxClipboard(): Promise<AskImage | null | undefined> {
	const wsl = !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
	let image =
		process.env.WAYLAND_DISPLAY || wsl ? await linuxClipboard(true) : undefined;
	if (image === undefined) {
		image = await linuxClipboard(false);
	}
	if (!image && wsl) {
		image = (await windowsClipboard()) ?? image;
	}
	return image;
}

/** Read an explicit clipboard paste without changing the clipboard or keeping temporary files. */
export async function readClipboardImage(): Promise<AskImage | null> {
	if (process.platform === "linux") {
		const image = await readLinuxClipboard();
		if (image !== undefined) {
			return image;
		}
	}
	const bytes = await getNativeClipboard()?.getImage();
	if (bytes === undefined) {
		throw new Error(
			"Image clipboard is unavailable. On Linux, install wl-clipboard or xclip; on WSL, enable Windows clipboard access."
		);
	}
	if (!bytes?.length) {
		return null;
	}
	const image = await convertToPng(
		Buffer.from(bytes).toString("base64"),
		"image/bmp"
	);
	if (!image) {
		throw new Error("The clipboard image could not be decoded.");
	}
	return { id: randomUUID(), ...image };
}
