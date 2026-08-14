# Frame verbs: the design pass

The design pass [plan 5](./05-frame-verb-table.md) asks for before any code, plus what was built as a
result. Read the plan first; this is its steps 1 and 2, and the record of which of step 3 was taken.

## 1. The inventory

Everything a sandboxed frame can send, with where each part is decided. "Denial" is the check the
broker applies before the effect runs.

| Verb | Request shape | Denial | Author surface | Host service |
|---|---|---|---|---|
| `api` GET/POST/PUT/PATCH/DELETE | `{ method, path, body? }` | the scope table (`scopes.ts`, `allowApi`) | `api.get/post/put/patch/del` | `fetch` |
| `subscribe` | `{ channel }` | channel is in the manifest's `events` **and** subscribable | `events.on` | `subscribe` |
| `state.get` | `{ key }` | key shape; host namespaces by plugin id | `state.get` | `stateGet` |
| `state.set` | `{ key, value }` | key shape, 1 MiB value cap | `state.set` | `stateSet` |
| `ui:toast` | `{ title, detail? }` | title non-empty | `ui.toast` | `toast` |
| `ui:copy` | `{ text }` | text is a string | `ui.copy` | `copy` |
| `ui:openPane` | `{ paneId }` | pane is one the plugin's own manifest declared | `ui.openPane` | `openPane` |
| `ui:openUrl` | `{ url }` | https only; frame must hold focus; one per second | `ui.openUrl` | `openUrl` + `frameHasFocus` |
| `ui:importer.done` | `{}` | surface is an importer | `ui.done` | `importerDone` |
| `ui:importer.close` | `{}` | surface is an importer or an overlay | `ui.close` | `importerClose` |
| `document:read` | `{}` | a document region exists beside this frame | `document.read` | `document.read` |
| `document:write` | `{ text }` | ditto, plus the 2 MiB document cap | `document.write` | `document.write` |
| `document:flush` | `{}` | ditto | `document.flush` | `document.flush` |
| `webview:navigate` | `{ url }` | surface is a webview; URL inside its declared hosts | `webview.navigate` | `webviewNavigate` |
| `webview:back/forward/reload` | `{ op }` | surface is a webview | `webview.back/forward/reload` | `webviewCommand` |
| `cancel` | `{ target }` | none — the broker forgets its own record | *(SDK-internal)* | — |
| `keydown` | `{ chord }` | chord is in the surface's declared claim set | *(SDK-internal)* | `keydown` |

Two shared budgets sit above all of it: 100 in flight and 1000 messages per ten seconds.

It does fit on one screen, which was the plan's own argument for the table.

## 2. Two designs

**(a) A declarative table the broker iterates.** `{ kind, paramsSchema, hostEffect }` rows; the switch
disappears and dispatch becomes a lookup.

**(b) One declaration the other spellings are derived from.** The switch stays exactly as it is;
`FrameServices` and `AcornBridge` become mapped types over the vocabulary, and the wire union is
asserted equivalent at the type level. Drift becomes a compile error; runtime behaviour is untouched.

**(b), and less of it than the plan sketched.** The plan already leaned this way and named the reason:
this is the sandbox's security membrane, and the table must not make validation implicit. Reading the
denial column above settles it. Those checks are not a schema — `openUrl` alone is a scheme policy, a
focus check and a rate limit, and the `importer.close` row differs from `importer.done` by a
surface-target rule that no `paramsSchema` field could express. Design (a) would move the readable
part into data and leave the interesting part in callbacks, which is a worse place to audit it from
than the switch it replaced.

Design (b) then splits into two halves that are not equally worth it:

- **Deriving `FrameServices` and the SDK's `api` literal as mapped types.** This is real work across
  three modules, and it buys less than it looks like: the sdk's `api` object is already typed
  `AcornBridge`, so the compiler already refuses a short implementation, and `FrameServices` members
  do not have one uniform shape to map over (`fetch` takes a signal, `openUrl` returns void, `document`
  is a nested optional whose absence IS a permission check).
- **Asserting the surfaces cover the wire.** This is the half that catches the bug that actually
  happened. The PUT scar was not a mis-shaped implementation; it was a verb present in the protocol
  and in the broker and absent from the author-facing type, and no pair of modules could see it
  because the MessagePort between them is untyped.

So: take the assertion, leave the derivation.

## 3. What was built

`packages/client-core/src/plugins/frames/verbs.ts` — types only, plus two `const … = true` lines.

- `FrameVerb` is derived from `PluginBridgeRequest` with a conditional type, so it is a projection of
  the protocol rather than a fourth hand-maintained list.
- `AuthorSurface` and `HostSurface` map each verb to a real member access on `AcornBridge` and
  `FrameServices`. A verb whose surface never grew a method fails to resolve.
- Two coverage assertions fail the build when either surface and the wire disagree in either
  direction.

Nothing imports it, and nothing needs to: `tsc --noEmit` runs over every file in the package. Both
directions were checked by hand before landing — deleting `put` from `AcornBridgeApi` and adding a
`ui:download` variant to the protocol each produce a compile error naming the short side.

Runtime behaviour, the dispatch switch, and every denial path are byte-for-byte unchanged, so
`broker.test.ts`'s 36 tests are the behaviour lock they were before.

## What is still open

The plan's step 4 — migrating verb groups onto a derived `FrameServices` — is deliberately not done,
for the reason in section 2. Reopen it if a second consumer of the vocabulary appears (a second host
shell, say), because that is when the derivation starts paying for itself. Until then the assertion
carries the whole cost of the drift it was written to stop, at one file and no runtime risk.
