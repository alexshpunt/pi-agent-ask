import {
	type AskSurfaceReservation,
	reserveAskSurface,
} from "./ask-surface.ts";

/** Own the shared question surface only while a persistent form is visible. */
export class AskSurfaceLease {
	private hidden: boolean;
	private owned = false;
	private disposed = false;
	private surface?: AskSurfaceReservation;
	private pending?: Promise<void>;
	private readonly signal?: AbortSignal;
	private readonly changed: () => void;

	constructor(options: {
		hidden: boolean;
		signal?: AbortSignal;
		surface?: AskSurfaceReservation;
		changed: () => void;
	}) {
		this.hidden = options.hidden;
		this.signal = options.signal;
		this.surface =
			options.surface ?? (this.hidden ? undefined : reserveAskSurface());
		this.changed = options.changed;
		if (this.hidden) {
			this.release();
		}
	}

	get visible(): boolean {
		return !(this.hidden || this.disposed) && this.owned;
	}

	async ready(): Promise<void> {
		while (!(this.hidden || this.owned || this.disposed)) {
			await this.acquire();
		}
		if (this.signal?.aborted || this.disposed) {
			throw new DOMException("Question form interrupted", "AbortError");
		}
	}

	setHidden(hidden: boolean): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		this.hidden = hidden;
		if (hidden) {
			this.release();
			this.changed();
			return Promise.resolve();
		}
		return this.acquire();
	}

	dispose(): void {
		this.disposed = true;
		this.release();
	}

	private release(): void {
		this.owned = false;
		this.surface?.cancel();
		this.surface = undefined;
		this.pending = undefined;
	}

	private acquire(): Promise<void> {
		if (this.owned) {
			this.changed();
			return Promise.resolve();
		}
		if (this.pending) {
			return this.pending;
		}
		const surface = this.surface ?? reserveAskSurface();
		this.surface = surface;
		const pending = surface
			.acquire(this.signal)
			.then(() => {
				if (this.disposed || this.hidden || this.surface !== surface) {
					return;
				}
				this.owned = true;
				this.changed();
			})
			.catch((error: unknown) => {
				if (!(this.disposed || this.hidden || this.surface !== surface)) {
					throw error;
				}
			})
			.finally(() => {
				if (this.pending === pending) {
					this.pending = undefined;
				}
			});
		this.pending = pending;
		return pending;
	}
}
