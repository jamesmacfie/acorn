# 02 — Host-owned task origin and link binding

**Resolved.** Original severity: high.

## Resolution

Descriptor row parsing now strips a foreign origin while preserving the row, and promotion checks
the same ownership rule again at the mutation boundary. Only the exact plugin id or its
`<plugin>:` namespace is accepted; everything else becomes `<plugin>:item`.

Task links receive the corresponding ownership check. Before create/link or attach, the host reads
its integration registry and verifies that the supplied connection belongs to the plugin's provider.
A foreign connection fails before `addTaskLink` runs. Tests cover exact, namespaced, missing and
foreign origins, malformed-field stripping, and a foreign connection id.

## Original finding

`packages/client-core/src/plugins/chrome/promotion.ts`:

```ts
prepare: (item, context) => ({
  origin: item.task?.origin ?? `${pluginId}:item`,
  …
})
```

`item` is a rail row — a body returned by the plugin's own node route. `item.task.origin` is
validated only as "a string, or absent" (`opt` in `chrome/data.ts`). Nothing checks that the value
belongs to the plugin that supplied it.

So a loaded plugin can return `{ task: { origin: 'github-pr' } }` on its rail-items route and the
host will stamp that origin onto the created task. The same is true of `linear`, `rollbar` and
`local`.

## Why the field exists, and why it is still wrong

The intent is legitimate and documented in `packages/protocol/src/api.ts`:

> Optional so established providers can preserve their pre-loader task origin. Other plugins use
> the host-derived `<plugin>:item` value and never need to set it.

Rollbar's migration is exactly that case: its existing tasks carry origin `rollbar`, not
`rollbar:item`, and forcing the namespaced form would orphan them. Correct requirement.

But the implementation grants far more than the requirement needs. Task origin drives icon and
label selection, and anything else keyed on origin now or later. A plugin choosing `github-pr`
makes its tasks indistinguishable from GitHub's in the rail and in any future behaviour that
switches on it.

It is also the same class of defect as the trust-prompt finding from the earlier review — a string
that arrived from an untrusted source rendered as though the host vouched for it — and it is worth
noticing that the class has now appeared twice. The general rule the codebase already applies
everywhere else is that **the host binds every namespace**: route prefixes, contribution ids,
command ids, provider ids and binding ids are all derived from the manifest by the host, never
taken from plugin-supplied values. Origin is the one that slipped.

## Fix

Accept only origins the plugin owns:

```ts
// chrome/promotion.ts — or better, beside the other host-binding helpers
const ownedOrigin = (pluginId: string, origin: string | undefined): string =>
  origin && (origin === pluginId || origin.startsWith(`${pluginId}:`))
    ? origin
    : `${pluginId}:item`
```

That keeps Rollbar's bare `rollbar`, keeps the namespaced `rollbar:item` form, and refuses
`github-pr`. Fall back to the derived value rather than rejecting the row: a bad origin is a
malformed field, and the existing contract for a malformed descriptor field is to drop the field
and log, not to lose the row.

Two related spots worth checking while in here:

- **Validate at parse, not only at use.** `isTask` in `chrome/data.ts` already validates row shape
  on arrival, and it has the plugin id in scope. Rejecting a foreign origin there means a bad row
  never reaches promotion, and the promotion helper keeps one code path.
- **The link ref.** `item.task.link` carries `connectionId` and `identifier` from the same
  untrusted body, and they become a real task link. A plugin naming another provider's
  `connectionId` should not be able to attach a link attributed to that provider. Confirm whether
  the link write path checks connection ownership; if it does not, that is the same fix one level
  down and belongs in this change.

## Tests

- `promotion.test.ts`: a row with `origin: 'github-pr'` promotes as `rollbar:item`; a row with
  `origin: 'rollbar'` keeps it; a row with `origin: 'rollbar:issue'` keeps it; absent origin gets
  the derived value.
- `data.test.ts`: a row whose origin names another plugin is rejected or stripped on arrival,
  whichever the fix chooses — and the row itself still renders.
- Whatever the link-ref check turns out to be, one test that a foreign `connectionId` cannot be
  attached.

## Acceptance record

No value a plugin returns from a route can produce a task attributed or linked through a different
plugin.
