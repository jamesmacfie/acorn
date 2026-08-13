# One eligibility module behind client registration

**Strength: Strong.** The duplicated code here is a security predicate.

## The problem, plainly

When a loaded plugin's roster row reaches the client, two separate passes turn it into things on
screen:

- `frames/register.tsx` registers the *rectangles* — sandboxed panes, overlays, settings pages,
  importers.
- `chrome/register.ts` registers the *data* — commands, keybindings, rail sources, content links,
  slots.

That split is fine — rendering a sandboxed iframe and registering a command palette row genuinely
are different jobs, and having two consumers of the roster is what makes the seam real. The problem
is what got duplicated *across* the split: the logic that decides **which plugins and surfaces are
allowed to exist at all**.

Two concrete duplications:

1. **`eligible()` is written twice** — `frames/register.tsx:412-421` and
   `chrome/register.ts:98-109`. Both walk the per-node roster, both keep installed rows, both apply
   first-wins-per-id. But they gate on trust *differently*: chrome filters untrusted bundles out
   up front (`if (client && !bundleAccepted(...)) continue`), while frames computes `trusted` later
   and threads it down. Same question — "may this plugin contribute?" — two answers-in-progress.

2. **The task-pane predicate is byte-identical copy-paste:**

   ```ts
   // frames/register.tsx:95
   .filter((entry) => entry.target === 'webview' || (entry.target === 'pane' && entry.scope !== 'project'))

   // chrome/register.ts:130
   frames.filter((frame) => frame.target === 'webview' || (frame.target === 'pane' && frame.scope !== 'project'))
   ```

   This isn't cosmetic: both copies feed the `openPane` allowlist — the list that decides which
   pane ids a sandboxed frame is permitted to ask the host to open. It is a security check,
   maintained in two places, connected by nothing.

There's also a smaller convention hiding here: the two sync passes must always run as a pair, and
they're invoked back-to-back at two different call sites (`apps/desktop/src/app/client/index.tsx:54-55`
and `PluginTrustDialog.tsx:114-117`), with a comment at the second explaining why. A pairing that
exists only as a comment is a pairing someone will eventually break.

## How it surfaces

Suppose a new frame target lands — say `target: 'drawer'`. Whoever adds it updates the predicate
they can see. Now:

- If they update the frames copy only: the drawer renders as a pane, but chrome's `openPane`
  allowlist doesn't contain it — so a frame that tries to open its own drawer is *denied by the
  host's security check*, and the error looks like a broker bug, three modules away from the
  actual missing line.
- If they update the chrome copy only: the allowlist now permits opening a pane that the frames
  pass never registered. Best case a dead command; worst case the allowlist is now wider than the
  set of real surfaces, which is exactly the direction a security allowlist must never drift.

Either way, `tsc` is silent and both test suites stay green, because each copy is locally
consistent. The trust-gate difference has the same shape: tighten the gate in chrome (say, add a
version check to `bundleAccepted`) and frames keeps rendering rectangles for a bundle chrome no
longer trusts.

## The plan

1. **Create `packages/client-core/src/plugins/contributions.ts`** owning three things:
   - `eligibleRows(nodeId)` — the roster walk, installed filter, first-wins-per-id, **and the trust
     gate**, decided once. Returns rows already labelled with their trust state so neither consumer
     re-derives it.
   - `declaredSurfaces(row)` — the surface classification: task panes (the predicate above),
     project panes, overlays. One spelling of each predicate.
   - `syncPluginContributions()` — calls the frames sync and the chrome sync, in order. The pairing
     becomes a function instead of a comment.
2. **Both register modules consume it.** Delete the two `eligible()` copies and both inline
   predicates. `frames/register.tsx` and `chrome/register.ts` become pure renderers over shared
   decisions: frames turns surfaces into components, chrome turns descriptors into registry rows.
3. **Replace the paired call sites** in `index.tsx` and `PluginTrustDialog.tsx` with the one
   wrapper.
4. **Test the new module directly.** It's plain `.ts`, so the existing node-env suite reaches it
   (unlike `frames/register.tsx`, which is structurally untestable today — see plan 6). The tests
   assert the questions that matter: who is eligible, what gates trust, which surfaces count as
   task panes.

## What gets better

- The security predicate has one definition; a new `target` value physically cannot diverge.
- The trust gate moves to one place, so tightening it tightens everything.
- The frames/chrome seam stays — two consumers, real seam — but it's now cut along the right line:
  identity-and-trust concentrated behind it, rendering strategy split in front of it.
- A meaningful slice of `frames/register.tsx`'s untested logic becomes tested `.ts` for free.

## Files

- `packages/client-core/src/plugins/contributions.ts` — new
- `packages/client-core/src/plugins/frames/register.tsx:95, 404, 412-421` — consumes it
- `packages/client-core/src/plugins/chrome/register.ts:98-109, 130` — consumes it
- `apps/desktop/src/app/client/index.tsx:54-55`, `packages/client-core/src/plugins/PluginTrustDialog.tsx:114-117` — call the wrapper
