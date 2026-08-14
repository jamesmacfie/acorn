# Move frame wiring decisions out of .tsx

**Strength: Worth exploring.** Plan 3 (the eligibility module, since landed as
`plugins/contributions.ts`) already carved off the eligibility walk and the trust gate; what's left
here is the registration branches and the host services.

## The problem, plainly

The client test suite runs in a plain Node environment and only picks up `*.test.ts` — no jsdom,
no Solid compiler, no component rendering. `packages/client-core/vitest.config.ts` says so itself:
"a green suite here proves nothing about the UI." That's a reasonable constraint. The unreasonable
consequence is that **the file extension decides what gets tested**: logic in a `.ts` file can be
covered; the same logic in a `.tsx` file structurally cannot.

The frames stack shows the result in one comparison. `chrome/register.ts` and
`frames/register.tsx` are deliberate siblings — the chrome file's own comment says *"Same shape as
that file, deliberately."* Same job (turn roster rows into registered contributions), same risk
profile, same era. One is `.ts`, one is `.tsx`:

| | `chrome/register.ts` | `frames/register.tsx` |
|---|---|---|
| Size | 358 lines | 411 lines |
| Unit tests | **457 lines, 25 tests** | **zero** |

The frames file even exports `_resetFrameContributions` — a test seam, documented as mirroring the
chrome one — **with no callers**. The scaffolding for tests exists; the tests can't.

Across the stack, roughly 1,500 lines of `.tsx` wiring sit outside the suite entirely:
`frames/register.tsx` (9 registration branches, route confinement), `PluginFrame.tsx` (all 14
host-service implementations, the port handshake, the intent-consumption race), and
`PluginTrustDialog.tsx` (the tier memo and `decide()`). Meanwhile over 2,000 lines of tests
concentrate on the pure `.ts` modules — `broker.ts`, `scopes.ts`, `permissions.ts`, and now
`contributions.ts`.

## How it surfaces

This is the review's clearest demonstration that bugs live where code is *called*, not inside pure
functions. Every documented defect in this stack sits in the untested wiring; none in the tested
modules:

1. **The stale-contributions bug** (`App.tsx:163-173`) — a reactive subscription created with
   `defer: true` never fired, so after switching Nodes the client kept the *previous* Node's plugin
   contributions: a disabled plugin kept its pane, rail source, poller, and settings page.
2. **The vanishing recognisers** (`plugins/github/src/client/contentLinks.ts:33-38`) — a
   module-scope "already registered?" guard silently skipped both of GitHub's content-link
   recognisers once Linear registered first. Import order as a hidden input.
3. **The one-key permanent disable** (`PluginTrustDialog.tsx:127-131`) — pressing Escape called
   `decide('rejected')`, permanently disabling a plugin with no undo surface anywhere in the UI.
4. **The empty ref-panel title** (`frames/register.tsx`, the refPanel branch) — the Solid
   reserved-`ref`-prop defect (see the arch rule that now guards it).

Four bugs, four call sites, zero in `broker.ts`/`scopes.ts`/`permissions.ts` — the three modules
holding effectively all the unit tests. The test effort is real; it's just parked where the bugs
aren't. There is partial cover from four desktop e2e specs, and they pin the important security
claims — but four end-to-end tests against fourteen service implementations and nine registration
branches is a coarse net, and that suite is being extracted out of core besides.

## Why this happened

`broker.ts` extracted the `FrameServices` interface *specifically* so the message-checking half
could be tested in bare Node. It worked — the checker has 36 tests. But it worked by relocating
every service *implementation* into `PluginFrame.tsx`, where nothing can follow. The seam achieved
its stated goal and moved the untestable surface rather than shrinking it. The repo has already
found the right corrective once: `frames/documentSurfaces.ts` was extracted *from*
`register.tsx` into plain `.ts` precisely to be testable — its header says so. The extraction just
stopped at one function.

## The plan

The principle: **decisions in `.ts`, instantiation in `.tsx`.** A component file may create
components; it should not decide anything worth testing.

1. **Extract `frames/registerPlan.ts`.** A pure function: roster rows + trust state in, a list of
   contribution descriptors out — which pane ids, which overlays (and their command + keybinding +
   slot triple), which settings pages, which importers; the decisions of today's nine branches.
   `register.tsx` shrinks to: take the plan, instantiate a component per entry. Test the plan the
   way `chrome/register.test.ts` already tests its sibling — that suite is the template, and
   `_resetFrameContributions` finally gets its caller.
2. **Extract `frames/frameServices.ts`.** A builder: `{ queryClient, binding, callbacks } → FrameServices`
   — the 14 implementations currently inlined in `PluginFrame.tsx:97-207`, including the two spots
   that hand-parse the raw prefs cache. `PluginFrame.tsx` keeps the component shell: the iframe,
   the port handshake, lifecycle. Test the services with fake callbacks, the same pattern
   `broker.test.ts` already uses from the other side of the seam.
3. **Take the dialog's decision logic too.** Plan 4 already made the diff run on grant keys, but
   the tier/diff memo and `decide()` still live in `PluginTrustDialog.tsx`; moving them beside the
   permission-line logic makes the Escape-to-reject class of bug a unit test instead of a
   manual-QA find.

Plan 3 has landed since this was written: eligibility, the trust gate, and the surface
classification are already out of `register.tsx` and tested in `plugins/contributions.ts` — so
`registerPlan.ts` starts from a smaller, cleaner file than the one this plan first described.

What this plan is *not*: adding jsdom, a Solid test renderer, or component tests. That's a bigger
decision with its own costs, and nothing here depends on it. The point is that most of what's
untested in these files isn't rendering — it's decisions that happen to live in files with the
wrong extension.

## What gets better

- The bug classes that have actually occurred get somewhere for their regression tests to live.
- The nine registration branches and fourteen services become unit-testable with the existing
  suite, no new infrastructure.
- `.tsx` files converge on the shape where a rendering-free suite is an honest signal.

## Files

- `packages/client-core/src/plugins/frames/register.tsx` — splits into plan + shell
- `packages/client-core/src/plugins/frames/PluginFrame.tsx` — `services()` (from line 97) moves out
- `packages/client-core/src/plugins/PluginTrustDialog.tsx` — the tier memo and `decide()` move out
- `packages/client-core/src/plugins/frames/documentSurfaces.ts` — the precedent to imitate
- `packages/client-core/src/plugins/chrome/register.test.ts` — the template for the new tests
