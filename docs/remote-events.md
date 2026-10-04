# Remote ask events

pi-ask exposes a local `pi.events` contract for trusted Pi extensions that run in the same Pi process.

Use this for local bridges: status cards, desktop helpers, or approval UIs. Do not use terminal keystroke automation. pi-ask does not expose a network API.

## External UI negotiation

Foreground `ask_user` in a non-TUI process emits `@eko24ive/pi-ask:external-ui` once per call, after validation and preview loading. This is a synchronous local event, not a wire protocol:

```ts
type ExternalAskConnection = {
  version: 1;
  mode: ExtensionContext["mode"];
  toolCallId: string;
  connect(provider: ExternalAskProvider): boolean;
};

type ExternalAskProvider = {
  version: 1;
  id: string;
  open(request: ExternalAskRequest): Promise<unknown>;
};

type ExternalAskRequest = {
  version: 1;
  flowId: string;
  toolCallId: string;
  title?: string;
  questions: AskQuestion[];
  signal: AbortSignal;
};
```

The bridge must already have checked its host's connection and capabilities. Offer a provider only for a supported host. The first valid provider wins; unsupported versions, another provider, and connections made after the listener returns are rejected. No connection means the existing cancelled non-TUI fallback. TUI and non-TUI background calls do not emit this event.

`open` receives cloned, normalized questions. Local file previews are included as text, not file paths. Question types reflect `presentSingleAsMulti`. Keep `flowId` and `toolCallId` as correlation ids; do not choose an answer automatically.

Resolve `open` with the same explicit `RemoteAskResponse` used by the submit channel below. The original tool call waits. pi-ask checks ids and values and computes labels, indices, notes, and elaboration itself. An invalid returned response is a tool error because the provider has finished. An invalid submit-channel response instead leaves the active form open so the UI can correct it.

The provider must listen to `signal` and close its UI/transport when it aborts. It aborts after answer, explicit cancel, operation abort, or failure, including when another local submitter completes the flow. Remove your own listeners and resources. Reject on disconnection or UI failure; do not turn these into user cancellation. Returning nothing is an error. Late responses are ignored; late submit-channel requests receive `flow_not_found`.

For example, inside a bridge extension whose host handshake has already completed:

```ts
pi.events.on("@eko24ive/pi-ask:external-ui", (data) => {
  const connection = data as ExternalAskConnection;
  if (connection.version !== 1 || !host.isConnected()) return;
  connection.connect({
    version: 1,
    id: "my-host",
    open: (request) => host.ask(request), // waits; closes on request.signal
  });
});
```

`host` above is the bridge's own transport, not a Pi API. Public types are in `src/external-ui.ts`. This API transports form data, not `ctx.ui.custom()` components or TUI keystrokes. Background questions, commands, replay, and settings remain TUI-only.

Connected external flows also use the started/completed/submit channels below. UI failures dispose the flow without a completed answer event. Notifications and Herdr blocked-state reporting remain on the TUI surface.

## Channels

Lifecycle:

- `@eko24ive/pi-ask:started`
- `@eko24ive/pi-ask:completed`

Remote submit:

- `@eko24ive/pi-ask:submit`
- `@eko24ive/pi-ask:submit-result`

## Started

Emitted after a validated ask UI flow opens.

```ts
type PiAskStartedEvent = {
  version: 1;
  flowId: string;
  toolCallId?: string;
  source: "tool" | "answer" | "answer:again" | "ask:replay" | "ask:resume";
  title?: string;
  questions: AskQuestion[];
  createdAt: number;
};
```

Use `flowId` for submit/correlation. Use `questions[].id` and `questions[].options[].value` for answers. `ask:resume` identifies a form recovered from an interrupted tool call. Started-event options preserve the public optional `recommended` boolean, which is presentation metadata only and never changes remote submission values or labels.

## Submit an answer

```ts
pi.events.emit("@eko24ive/pi-ask:submit", {
  version: 1,
  requestId: `bridge-${Date.now()}`,
  flowId,
  response: {
    kind: "answer",
    mode: "submit",
    answers: {
      questionId: { values: ["option-value"] },
    },
  },
});
```

Answer shape:

```ts
type PiAskRemoteAnswer = {
  values?: string[];
  customText?: string;
  note?: string;
  optionNotes?: Record<string, string>;
};
```

Rules:

- `values` must match option `value`s from the started event
- keys in `answers` must match question ids
- labels and indices are recomputed by pi-ask
- a remote `answer` replaces the current answer set; stale UI answers are not merged
- `mode` defaults to `"submit"`; use `"elaborate"` to complete as an elaboration request

## Cancel

```ts
pi.events.emit("@eko24ive/pi-ask:submit", {
  version: 1,
  requestId: `bridge-${Date.now()}`,
  flowId,
  response: { kind: "cancel" },
});
```

Cancel must be explicit. pi-ask does not infer cancel/approve/deny from labels or button names.

## Submit result

After a submit request, pi-ask emits:

```ts
type PiAskSubmitResultEvent =
  | { version: 1; requestId: string; flowId: string; ok: true }
  | {
      version: 1;
      requestId: string;
      flowId: string;
      ok: false;
      error: "flow_not_found" | "invalid_request" | "invalid_answer";
      message: string;
    };
```

Correlate by `requestId` and `flowId`. Do not depend on strict ordering between `submit-result` and `completed`.

## Completed

Emitted when the flow resolves.

```ts
type PiAskCompletedEvent = {
  version: 1;
  flowId: string;
  toolCallId?: string;
  source: "tool" | "answer" | "answer:again" | "ask:replay" | "ask:resume";
  result: AskResult;
  completedAt: number;
};
```

## Minimal bridge

```ts
export default function piAskBridge(pi: any) {
  pi.events.on("@eko24ive/pi-ask:started", (event: any) => {
    const question = event.questions[0];
    const option = question.options[0];

    pi.events.emit("@eko24ive/pi-ask:submit", {
      version: 1,
      requestId: `bridge-${Date.now()}`,
      flowId: event.flowId,
      response: {
        kind: "answer",
        answers: {
          [question.id]: { values: [option.value] },
        },
      },
    });
  });

  pi.events.on("@eko24ive/pi-ask:submit-result", (event: any) => {
    if (!event.ok) console.error(event.error, event.message);
  });
}
```

Third-party integrations own their own UI policy and mappings. For example, a bridge may map a button to `{ values: ["yes"] }`, but pi-ask will never guess that mapping from the label.

## Local smoke test

Create a temporary bridge and run pi with only this repo extension plus the bridge:

```bash
cat > /tmp/pi-ask-smoke.ts <<'EOF'
export default function smoke(pi: any) {
  pi.events.on("@eko24ive/pi-ask:started", (event: any) => {
    const q = event.questions[0];
    setTimeout(() => {
      pi.events.emit("@eko24ive/pi-ask:submit", {
        version: 1,
        requestId: `smoke-${Date.now()}`,
        flowId: event.flowId,
        response: { kind: "answer", answers: { [q.id]: { values: ["tool"] } } },
      });
    }, 2500);
  });
}
EOF

pi \
  --no-extensions \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-context-files \
  -e "$PWD/src/index.ts" \
  -e /tmp/pi-ask-smoke.ts \
  --skill "$PWD/skills/ask-user"
```

Then ask Pi:

```txt
Use ask_user. Title: pi-ask smoke. Ask one single-select question id tool with options tool and nope.
```

The ask UI should open and auto-submit `tool` after about 2.5 seconds.
