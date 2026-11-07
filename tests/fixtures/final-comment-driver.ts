import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function finalCommentDriver(pi: ExtensionAPI): void {
	let count = 0;
	pi.on("session_start", (_event, ctx) => {
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (...args) => {
				const component = await factory(...args);
				const cancel = count++ === 1;
				const keys = [
					"1",
					...(cancel ? ["\u001b[B"] : []),
					"n",
					cancel ? "declined for revision" : "ready for review",
					"\r",
					"\r",
				];
				const next = () => {
					const key = keys.shift();
					if (key !== undefined) {
						component.handleInput?.(key);
						setTimeout(next, 80);
					}
				};
				setTimeout(next, 100);
				return component;
			}, options);
	});
}
