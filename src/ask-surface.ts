let surfaceTail: Promise<void> = Promise.resolve();

/** Serialize ask surfaces. Aborted queued callers leave the input lock in FIFO order. */
export async function withAskSurface<T>(
	signal: AbortSignal | undefined,
	run: () => Promise<T>
): Promise<T> {
	const previous = surfaceTail;
	let release: (() => void) | undefined;
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	surfaceTail = previous.then(() => next);
	try {
		await acquireSurface(previous, signal);
		return await run();
	} finally {
		release?.();
	}
}

function acquireSurface(
	previous: Promise<void>,
	signal: AbortSignal | undefined
): Promise<void> {
	if (!signal) {
		return previous;
	}
	if (signal.aborted) {
		return Promise.reject(
			new DOMException("Question form interrupted", "AbortError")
		);
	}
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(new DOMException("Question form interrupted", "AbortError"));
		};
		signal.addEventListener("abort", abort, { once: true });
		previous.then(() => {
			signal.removeEventListener("abort", abort);
			if (signal.aborted) {
				abort();
				return;
			}
			resolve();
		});
	});
}
