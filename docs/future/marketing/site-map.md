# The site map

The full page tree for the site planned in [README.md](./README.md), with the internal source
doc every docs page is split from. The rule this file enforces: internal docs remain the source
of truth, public pages are derived from them, and a public page never says something the owning
internal doc doesn't. When behaviour changes, the internal doc changes first and the public page
follows.

## Marketing pages

Hand-authored Astro pages, outside the Starlight tree:

- **`/`** — hero, the feature wall (one GIF + JPG poster per feature, assets in one predictable
  directory shared with the repo README), the extensibility story as a first-class section (not
  a footnote — "two tiers, permanently" and "descriptors for facts, trees for UI, rectangles for
  pixels" are the differentiators), download CTA.
- **`/download`** — per-platform install. Ships when a signed macOS build exists; until then the
  page is not linked from the nav.
- **`/plugins`** — the plugin directory. A static list of the bundled and
  first-party-as-loaded plugins (rollbar, linear, http, database, model-providers, nodes-file) with
  each one's permission rationale, plus "build your own" pointing at the docs. Registry-fed later,
  if ever, per [../ecosystem/blockers.md](../ecosystem/blockers.md).
- **`/blog`** — posts plus RSS. Empty at launch is fine; the route exists so the first post has
  a home.
- **`/changelog`** — parsed from the repo `CHANGELOG.md` (which must be created; see the work
  plan in README.md).
- **`/agent-guide.md`**, **`/llms.txt`**, **`/llms-small.txt`**, **`/llms-full.txt`** — served
  as `text/markdown`.
- **`/schemas/acorn-plugin.schema.json`** — the published manifest schema, self-identifying via
  its own `$schema` URL so editors validate `acorn-plugin.json` against it.

## Docs sidebar

Starlight groups. Each page names its source; "split" means the internal doc carries more than
the public page will, and the public page takes the user-facing subset.

### Start here

| Page | Source |
| --- | --- |
| What is acorn | split of `docs/architecture-overview.md` (topology in one picture) + `docs/features.md` |
| Install | new; per-platform, blocked on signing for macOS download links |
| Quick start | new; first workspace → first task → first agent run |
| Concepts | split of `docs/workspaces-and-tasks.md` (Workspace → Task → Panes) + the node/client/fleet story from `docs/architecture-overview.md` |

### Using acorn

One page per topic, each a user-facing split of the matching internal doc:

| Page | Source |
| --- | --- |
| Workspaces and tasks | `docs/workspaces-and-tasks.md` |
| Terminal and agents | `docs/terminal-and-agents.md` + `docs/managed-agents.md` |
| Dashboards | `docs/dashboards.md` (59K internal; the public page is the using-it subset, not the design record) |
| Schedules | `docs/schedules.md` |
| Notes and memory | `docs/notes-and-memory.md` |
| HTTP client | `docs/http-client.md` |
| Command palette and shortcuts | `docs/command-palette-and-shortcuts.md` |
| Integrations | `docs/integrations.md` + `docs/github-integration.md` |

### Automation

| Page | Source |
| --- | --- |
| Public API | `docs/api-reference.md` (the bearer `/api/v1` surface) |
| Agent tools and MCP | `docs/agent-tools.md` + `docs/mcp.md` |

### Plugins

The centrepiece. The page list is here for completeness; the design — including what is
generated versus written, and the section-to-page mapping out of `docs/plugin-authoring.md` —
is in [plugin-reference.md](./plugin-reference.md).

| Page | Source |
| --- | --- |
| Why plugins work this way | distilled from `docs/extensibility.md` |
| Build your first plugin | `docs/plugin-authoring.md` §§ scaffold → package → complete example |
| The package and manifest | `docs/plugin-authoring.md` § the manifest |
| Manifest reference | **generated** from `packages/protocol/src/pluginContract.ts` |
| Contribution points (catalogue, one page per key) | `pluginContract.ts` + the owning feature docs |
| The node half | `docs/plugin-authoring.md` § the node half + `packages/node-core/src/server/plugin/types.ts` |
| The client half and the frame SDK | `docs/plugin-authoring.md` §§ client half, reaching the bridge + `packages/plugin-sdk/src/public.ts` |
| Permissions and security | `docs/plugin-authoring.md` § permissions + `docs/security.md` (trust model subset) |
| Storage and migrations | `docs/plugin-authoring.md` § storage and migrations |
| Examples | teaching plugins (new) + the first-party-as-loaded plugins as real-world cases |
| Compatibility and versioning | `docs/plugins.md` § what is published + `packages/protocol/src/pluginApiVersion.ts` |

### Help

| Page | Source |
| --- | --- |
| Troubleshooting | new; seeded from the recurring answers (trust prompts, reload limits, worktree/env constraints) |

## What is deliberately not public

- `docs/plugins.md` as a whole — it is the internal reference manual and design record; the
  public tree takes the authoring-facing subset only.
- `docs/first-party-plugins.md`, `docs/third-party/`, `docs/future/` — tier audits, migration
  records, and design notes. The public compatibility and security pages state the conclusions
  these files argue for, without the argument.
- Anything about unshipped work. The public docs describe what loads today; roadmap talk stays
  in the blog if it happens at all.

## What closes this file

The site's nav and sidebar match this tree (or this file has been updated to match what
shipped, with the deviation noted).
