# The plugin-api client barrel

**Strength: Speculative.** A watch item, not a work item. Recorded so the growth stays a decision
instead of a drift.

## The problem, plainly

`@acorn/plugin-api` is the facade every plugin imports the host through — a deliberate, phase-1
move of the third-party work, and the right one. But look at its proportions:

| Entrypoint | Exports |
|---|---|
| `client` | **173** |
| `node` | **130** |
| `ui` | 28 |
| `ui/diff` | 27 |
| `ui/host` | 8 |
| `ui/sdk` | **6** |
| `ui/editor` | 5 |

377 exported names, and by rule the package adds no behaviour — the arch tests assert it's pure
re-exports. An interface with zero implementation behind it is, by definition, exactly as
complicated as what it fronts. Its value today is change *detection* (the surface snapshot test
fails when a name appears or disappears), not abstraction: nothing gets simpler by going through
it; it just gets noticed.

The depth is also inverted against importance. `ui/sdk` — six exports — fronts the one real trust
boundary in the system, the sandboxed frame bridge. It's the deepest interface in the package and
the model for what the others could be. `client` — 173 exports — fronts no boundary at all (its
consumers run in the same realm) and behaves like a namespace: `plugins/github/src/client/PullList.tsx`
imports **22 names on one line**. When a single component needs 22 names from your facade, authors
aren't consuming a contract; they're reaching through a very wide window into the host.

One small factual wrinkle while we're here: the snapshot guards **names only** — its own comments
admit type-*shape* changes under a stable name pass through, caught only by `tsc` across the plugin
fleet.

## How it surfaces

Slowly, which is why this is speculative. Every one of the 377 names is a compatibility promise to
third-party authors the moment the loaded-plugin tier opens up. Promises are cheap to make by
re-export and expensive to retract; the surface only ratchets up. The day a host refactor wants to
rename or remove something, each of those names is a small negotiation — and the width was never
chosen, just accumulated. The 22-names-on-one-line import is what author code shaped by a
namespace looks like; author code shaped by a contract (the `ui/sdk` consumers) imports a handful
of deep objects instead.

## The plan (deliberately light)

1. **Now:** adopt the ratchet informally — additions to `client`/`node` get the same question a
   new dependency gets: does a third-party plugin *need* this, or is it convenient for a
   first-party one that could import deeper? The snapshot test already makes every addition
   visible in review; this is just deciding to read it that way.
2. **Later, when the third-party client surface stabilises:** curate toward the `ui/sdk` shape —
   fewer, deeper objects (a query surface, a registration surface, a host-UI surface) rather than
   173 siblings. Let real third-party usage data pick the clusters. No big-bang rewrite; the barrel
   can keep re-exporting during any transition.
3. **Not proposed:** shrinking it today. First-party plugins are the only consumers, the snapshot
   keeps changes honest, and premature curation would be guessing at which names matter.

## What gets better (eventually)

- The compatibility surface promised to third parties becomes a chosen size, not an accumulated one.
- The facade's one deep entrypoint stops being the exception.

## Files

- `packages/plugin-api/src/client/index.ts` — 173 exports, the eventual curation target
- `packages/plugin-api/src/surface.snapshot.txt`, `surface.test.ts` — the ratchet mechanism
