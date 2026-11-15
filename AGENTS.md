# Pi Agent Ask

Read `docs/contract.md` before changing tool behavior or the form UX, and `docs/architecture.md` before moving module boundaries. Update the matching document in the same change: usage in `README.md`, behavior and UX in `docs/contract.md`, module boundaries in `docs/architecture.md`, settings and keymaps in `docs/configuration.md`.

Keep state logic in plain TypeScript modules and the Pi and TUI wiring thin, so state transitions stay testable without rendering a terminal.

## Commands

- `pnpm test`: unit tests in `tests/*.test.ts`.
- `pnpm test:integration`: real-Pi cases in `tests/integration/` through `pi-test`.
- `pnpm typecheck` and `pnpm check` (Ultracite on Biome).
- `pnpm dev [dir]`: run Pi in `dir` with only this extension loaded.

## Verification fixtures

When a real-Pi driver intercepts a singleton module, import and invoke the production entry point from that driver so both use the same module graph. Confirm that the loading gate was entered before accepting a RED result.

For UI-only background-question demonstrations, use a deterministic provider or suppress answer-message delivery through the driver's API proxy. Changing only the enqueue context does not isolate inference: the runtime can retain its lifecycle context.

## Commits and releases

Commit messages follow Conventional Commits (`commitlint.config.cjs`). A release is published by `.github/workflows/release.yml` when a `v*` tag is pushed. The workflow publishes to npm and creates the GitHub Release from that version's `CHANGELOG.md` section (`scripts/release-notes.ts`), so add the section before tagging; `CONTRIBUTING.md` still describes the upstream semantic-release flow, which this fork does not use.
