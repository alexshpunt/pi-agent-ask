let surfaceTail: Promise<void> = Promise.resolve();

export interface AskSurfaceReservation {
	acquire(signal?: AbortSignal): Promise<void>;
	cancel(): void;
	run<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T>;
}

/** Reserve arrival order before a detached runner is ready to mount its form. */
export function reserveAskSurface(): AskSurfaceReservation {
	const previous = surfaceTail;
	let release: (() => void) | undefined;
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	// Cancelled slots still wait for their predecessors before handing off.
	surfaceTail = previous.then(() => next);
	const cancellation = new AbortController();
	let started = false;
	const cancel = () => {
		cancellation.abort();
		release?.();
	};
	const acquire = async (signal?: AbortSignal) => {
		if (started) {
			throw new DOMException("Question form interrupted", "AbortError");
		}
		started = true;
		try {
			await acquireSurface(
				previous,
				signal
					? AbortSignal.any([signal, cancellation.signal])
					: cancellation.signal
			);
		} catch (error) {
			cancel();
			throw error;
		}
	};
	return {
		acquire,
		cancel,
		async run(signal, run) {
			try {
				await acquire(signal);
				return await run();
			} finally {
				cancel();
			}
		},
	};
}

/** Serialize foreground, background, and recovered question surfaces. */
export function withAskSurface<T>(
	signal: AbortSignal | undefined,
	run: () => Promise<T>
): Promise<T> {
	return reserveAskSurface().run(signal, run);
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
