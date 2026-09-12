# What is refused, on the record

Part of [docs/future/marketing/](./README.md). The refusals this folder already states inline,
collected so a later session argues with the reasoning instead of with silence. Nothing here is new;
each entry names where it is argued in full. First collected 2026-08-30.

The site's refusals come in two shapes: things the site will not build, and things the site will not
say. The second shape matters more, because the internal docs are unusually honest and a public page
is where that gets laundered away by accident.

## Nothing server-side until a registry exists

Static output, static hosting. A Workers app only pays off once a live registry endpoint exists, and
[the ecosystem blockers](../ecosystem/blockers.md) put that behind containment and signing. Next.js
buys pages acorn does not have — pricing, dashboards, i18n — so it buys nothing here
([README.md](./README.md) § The decisions).

## No live registry endpoint; `/plugins` is a static list

Same reason, one page down. It becomes dynamic when the ecosystem work says so and not before
([README.md](./README.md) § Deliberately not doing now).

## No docs versioning snapshots yet

Plan the seam — `versions/<v>/` directories plus a `manifest.json`, non-canonical paths excluded from
the sitemap and llms.txt — and build none of it until `PLUGIN_API_MAJOR` first moves. There is exactly
one version today ([README.md](./README.md) § Deliberately not doing now).

## No i18n

Starlight supports it; acorn has no second-language audience
([README.md](./README.md) § Deliberately not doing now).

## No separate repository for the site

The point of `apps/site/` is that the manifest reference is generated from
`packages/protocol/src/plugin/contract.ts` in the same build, with a CI check that regenerated output
matches committed output. A separate repo turns that into a publish-and-consume pipeline for no
benefit ([README.md](./README.md) § The decisions).

## The site distinguishes enforced resources from declared intent

The node half's host, filesystem, environment, process, and network grants are enforced by its
permission-scoped worker and RPC context. Scheduled/check intent remains declared because acorn
cannot verify plugin-authored behavior. The site must preserve that split
([README.md](./README.md) § Honesty constraints the public docs inherit).

## The site never implies signing, review, or a deprecation program

There is none of the three. If discovery ever exists it is explicitly unreviewed, and trust is
enforced on the user's own devices. The compatibility promise is exactly the `PLUGIN_API_MAJOR`
promise and nothing more, and the compatibility page says so
([README.md](./README.md) § Honesty constraints the public docs inherit).

## A public page never says something its owning internal doc does not

Public pages are splits and distillations of internal docs, per the mapping in
[site-map.md](./site-map.md). Internal docs stay the source of truth
([README.md](./README.md) § Honesty constraints the public docs inherit).

## Four things stay internal

`docs/plugins.md` as a whole, because it is the internal reference manual and design record and the
public tree takes only the authoring-facing subset. `docs/first-party-plugins.md`,
`docs/loaded-plugin-migration.md`, and `docs/future/`, because tier audits, migration records, and
design notes are the argument and the public pages state only the conclusions. And anything unshipped:
the public docs describe what loads today, and roadmap talk stays in the blog if it happens at all
([site-map.md](./site-map.md) § What is deliberately not public).
