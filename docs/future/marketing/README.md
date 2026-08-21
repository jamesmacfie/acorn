# The marketing site: decisions and work plan

Design notes from the marketing-site planning session (2026-08-21). The question asked: acorn
needs a public site — marketing pages plus developer docs — and the plugin story (the manifest
schema, how a plugin extends the node, and how that projects into the client UI) has to be the
centrepiece, because it is the reference point for both the maintainer and third-party authors.
The neighbours vendored under `references/` were surveyed for their sites: herdr, cmux, bb,
orca, and emdash. This file records the decisions; [site-map.md](./site-map.md) holds the page
tree; [plugin-reference.md](./plugin-reference.md) designs the plugin docs in detail.

## What the survey found

Only two of the five keep their site in-repo, and they set the bar differently:

- **herdr** (`references/herdr/website/`) is the strongest all-round model: Astro + Starlight,
  hand-authored marketing pages beside Starlight docs, a config reference generated into a
  structured JSON file and rendered by a filterable component with a CI check keeping the JSON
  in sync with the Rust source, docs versioning by frozen snapshot directories, a full llms.txt
  family served as `text/markdown`, and a plugin marketplace page server-rendered from a
  registry JSON with an explicit no-fake-data-in-prod rule.
- **cmux** (`references/cmux/web/`) — the project with the "Composer" input — is a large
  Next.js site. Its best trick: the config-reference page walks the same JSON Schema the app
  validates settings with, so docs and validation share one artifact. Also: per-agent SEO
  pages, Pagefind search built at deploy time, and release-vs-nightly docs channels.
- **bb** (`references/bb/apps/web/`) has no docs site, but three patterns worth taking: JSON
  Schemas published at stable self-identifying URLs so authors get editor autocomplete, a
  changelog page parsed from the repo `CHANGELOG.md` with a per-version headline map, and
  teaching example plugins (one per capability, each with a README) that function as docs.
- **orca** and **emdash** keep their sites in separate repos. orca's contribution is the README
  feature wall: one GIF plus a JPG poster per feature, in one predictable asset directory,
  reused by the README and the landing page. emdash contributes only its tidy ADR convention.

## The decisions

**Stack: Astro + Starlight, static output.** Herdr is the template — it is the only surveyed
site that solves generated reference, llms.txt, versioning, and a plugin directory at once, on
a static host. Marketing pages are hand-authored Astro pages; docs are Starlight MDX. cmux's
Next.js flexibility buys pages acorn does not have (pricing, dashboards, i18n), and bb's
Workers app only pays off once a live registry endpoint exists — which
[docs/future/ecosystem/blockers.md](../ecosystem/blockers.md) says is not soon.

**Location: in-repo, at `apps/site/`.** Matches the `apps/desktop` / `apps/node` convention,
and it is the point of the whole exercise: the manifest reference is generated from
`packages/protocol/src/pluginContract.ts` in the same build, with a CI check that regenerated
output matches committed output (herdr's `config_reference_check` pattern). A separate repo
would turn that into a publish-and-consume pipeline for no benefit.

**Hosting: static deploy to Cloudflare.** Pages or Workers static assets, whichever is less
ceremony at build time. Nothing server-side until a registry exists.

**Scope: full marketing, including download.** The download page is planned into the IA now and
ships when a signed macOS build exists — that dependency is the Apple Developer ID /
notarization decision (Option A R2 vs Option B GitHub Releases, undecided). The docs do not
wait for it.

## Honesty constraints the public docs inherit

The internal docs are unusually honest and the public docs must not launder that away:

- The node half is **disclosed, not contained**. Surfaces rendering `permissions.node` or
  `permissions.net` must say "declared", never "enforced". Only `permissions.api` — the six
  grantable frame scopes — is genuinely enforced, by `frames/scopes.ts`.
- There is no signing, no registry, no review, and no deprecation program. If discovery ever
  exists it will be explicitly unreviewed; trust is enforced on the user's devices.
- The compatibility promise is exactly the `PLUGIN_API_MAJOR` promise ('2', exact string
  match): a plugin that loads under a major keeps loading under it. Nothing more is promised,
  and the compatibility page says so.

A public page never says something the owning internal doc doesn't. Internal docs stay the
source of truth; public pages are splits and distillations of them, per the mapping in
[site-map.md](./site-map.md).

## The work plan

1. **Scaffold.** `apps/site` with Astro + Starlight; landing page and the Start here / Using
   acorn docs groups, split from the existing `docs/*.md` topic files.
2. **Plugin docs.** Split `docs/plugin-authoring.md` and `docs/extensibility.md` into the
   public plugin tree per [plugin-reference.md](./plugin-reference.md).
3. **Generated reference.** The manifest reference generated from
   `packages/protocol/src/pluginContract.ts`, the JSON Schema published at
   `/schemas/acorn-plugin.schema.json`, and the CI sync check. This phase is the reason the
   site is in-repo.
4. **Agent-facing docs.** The llms.txt family via `starlight-llms-txt` (`/llms.txt`,
   `/llms-small.txt`, `/llms-full.txt`) plus a hand-written `/agent-guide.md`. For an agent
   workspace this is product surface, not SEO — herdr's docs landing literally offers "let
   your agent introduce you".
5. **The rest of marketing.** Feature-wall assets (orca's GIF + JPG poster convention, one
   directory shared by README and landing page); `/changelog` parsed from a repo
   `CHANGELOG.md` (bb's parser — note there is no root `CHANGELOG.md` today, creating one is
   part of this phase); the `/plugins` directory page as a static list of the bundled and
   first-party-as-loaded plugins, registry-fed later if the ecosystem gates in
   [blockers.md](../ecosystem/blockers.md) ever clear.

The download page slots in whenever signing lands; it blocks nothing else.

## Deliberately not doing now

- **Docs versioning snapshots.** Plan the seam herdr-style — `versions/<v>/` directories plus
  a `manifest.json`, non-canonical paths excluded from sitemap and llms.txt — but build
  nothing until `PLUGIN_API_MAJOR` first moves. Today there is exactly one version.
- **i18n.** Starlight supports it; acorn has no second-language audience yet.
- **A live registry endpoint.** The `/plugins` page is a static list until the ecosystem
  work says otherwise.

## What closes this file

`apps/site` exists and phases 1–3 are shipped: the site builds, the plugin docs are live, and
the generated manifest reference has its CI check.
