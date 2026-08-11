# Toast

Transient, self-dismissing feedback: "Saved", "Copied", "Send failed". shadcn ships Sonner;
Bootstrap ships Toasts. acorn has **no toast system at all** — and the workarounds are the
clearest evidence in the codebase that one is missing, because three plugins have invented
*text-channel* toasts and the frame bridge already promises one.

## Today

- The frame bridge API already has `bridge.ui.toast(message)` — called by linear
  (`plugins/linear/src/frame/app.tsx:130`, "Copied to the clipboard") and rollbar
  (`plugins/rollbar/src/frame/app.tsx:79`). The host side fulfils it, so *some* rendering exists,
  but there is no shared component or shell-side API for compiled code.
- Fake toasts rendered as inline muted text:
  - notes: `.notes-save-state` — `'saving…' / 'saved ·'` in the toolbar (`NotesPane.tsx:327`)
  - context: `.context-tray-msg` — "Sent." / "Queued — delivers when the agent is idle." / "Send
    failed." AND errors, same span, same styling (`ContextPane.tsx:132`)
  - memory: success ("Saved → path") and failure through one muted span (`MemorySection.tsx:107`)
- Copy feedback is split three ways: `CopyButton`'s inline check-mark, docker's hand-rolled
  `copied()` + `setTimeout(1500)` pair (`ContainerDetail.tsx:162-179`), and the frames' bridge
  toast.
- Meanwhile 17 shell sites use inline `.action-error` for things that are arguably transient
  (see [alert.md](./alert.md) — the two components split that pile between them).

## Proposed API

```tsx
// shell-side, host-owned
export function toast(message: string, opts?: {
  tone?: 'neutral' | 'success' | 'danger'
  durationMs?: number            // default ~4000; danger persists longer
})
// plus a <ToastHost/> mounted once by the shell root (App.tsx), rendering a
// bottom-right stack with role="status" (danger: role="alert")
```

Deliberately minimal: no actions, no promise-tracking, no custom JSX bodies until a real consumer
needs them. A toast that needs a button is usually an Alert or a notification-bell entry.

## How to build it

- State + component in `packages/client-core/src/notifications/toast.tsx` — NOT in `ui/`: a
  module-level signal store is shell state, and the ui/ purity rule
  (`tools/arch/boundaries.test.ts`) rightly keeps it out. Export the `toast()` function on
  `@acorn/plugin-api/client` (or `/ui/host`), mirroring how registries are exposed.
- The host handler behind `bridge.ui.toast` should call this same `toast()` so frames and shell
  share one stack and one look.
- CSS `.ui-toast` can still live with the overlays role sheet (`styles/overlays.css`), tokens only;
  z-slot from the existing ladder in `ui/tokenAxes.ts` (add `--z-toast` and classify it; the
  z-order invariants test must be updated deliberately).
- Auto-dismiss must pause on hover/focus; respect reduced-motion for the slide-in.

## Refactors

- notes' save state, context's sync message, memory's saved message → `toast()` (their failure
  branches → `toast(tone:'danger')` or inline Alert, judged per-site: if the user must *act*, it's
  an Alert; if they just need to know, it's a toast).
- docker's two `copied()` timers → `CopyButton` where the shell clipboard is available, else
  `toast('Copied')`.
- Confirm the bridge path: linear/rollbar calls route into the shared stack unchanged.
- Post-action successes currently rendered as `.settings-notice role=status` that disappear on
  re-render — case-by-case.

## Notes

- Position: bottom-right, above the terminal drawer (`--term-drawer-h` is already published as a
  CSS var by the terminal plugin — the stack can offset by it).
- Don't migrate `.action-error` failures that block a form into toasts; those need to stay next to
  the thing that failed (Alert / Field error).
