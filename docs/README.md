# Docs

This folder keeps only the documentation needed to understand and maintain the extension without turning docs into a second copy of the code.

## Files

- `configuration.md` — configuration guide for pi-agent-ask keymaps, behaviour, and notifications
- `contract.md` — external behavior, tool payload/result details, and UX guarantees
- `remote-events.md` — local inter-extension event contract, bridge examples, and smoke-test steps
- `architecture.md` — module boundaries and invariants

## Reading order

- start with `configuration.md` for config-editing rules
- read `contract.md` for behavior
- read `remote-events.md` for local bridge/event integration
- read `architecture.md` for code layout

## Local test run

From repo root, run:

```bash
pnpm dev
pnpm dev ../some-target-folder
```

This starts pi in isolated mode, loads only this extension, and uses the optional folder as `--cd` target.

## Rule of thumb

If a detail is about implementation mechanics, it should usually live in `src/` or `tests/`, not here.
