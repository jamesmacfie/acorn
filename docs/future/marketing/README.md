# The acorn website

Date: October 15, 2026. Status: proposed. Implementation not started. This folder replaces the
August 2026 site notes, which remain in Git history.

This programme builds acorn's public website in `apps/site/`: a landing page, a page per feature, a
download page, a changelog, and the documentation. The documentation is the main job. Read this page
before you pick up a phase, then read the phase file and the design pages it links to.

## What the site has to do

A visitor arrives knowing nothing about acorn. The site has to do five things, in this order:

1. Say what acorn is, in one screen, before anything else. acorn does a lot, so this is the hardest
   part of the whole programme. [Phase 1](./01-positioning.md) owns it.
2. Show the product. Every picture of acorn's UI on the site is drawn by acorn's own components and
   stylesheets, not a screenshot. See [real UI, not screenshots](#real-ui-not-screenshots).
3. Get acorn onto the visitor's machine: download it, install it, or build it from source.
4. Teach them to use it: every feature, setting, built-in plugin, harness, permission, and the
   security model.
5. Teach them to extend it: the plugin system, with a page for every manifest option and every place
   a plugin can draw, each with a working example and a picture of what it draws on the desktop and
   in the terminal.

The audience is developers who work with coding agents. Every page is written for a person. The site
also publishes `llms.txt` and a Markdown copy of each page, because agents read docs too, but nothing
is written for them first. [Voice](./voice.md) says how the site talks.

## Decisions

**Astro with Starlight, static output.** Marketing pages are hand-written Astro pages. The docs are
Starlight MDX, with Starlight's header, sidebar, search, and footer replaced by acorn's own
components. Astro ships no JavaScript unless a component asks for it, and Starlight brings sidebars,
a table of contents, previous and next links, Pagefind search, and accessible defaults. hunk, herdr,
opentui, t3code, flue, gh-dash, and opencode all build their sites this way
([research](./research.md)). Next.js and a server buy nothing here: there are no accounts, no pricing,
and no live data.

**In the repository, at `apps/site/`.** The site reads the plugin manifest contract, the kit's support
table, the extension point list, the design tokens, and the stylesheets straight from the packages
that own them. A separate repository would turn each of those into a publish step that can drift.

**Static hosting on Cloudflare, at `acorn.sh`.** The domain is already promised:
`packages/plugin-types/acorn-plugin.schema.json` and `create-acorn-plugin` point every scaffolded
manifest at `https://acorn.sh/schemas/acorn-plugin.schema.json`, and nothing serves it. Every pull
request that touches the site gets a preview deploy.

**Generated where it can be, checked where it can't.** Anything the code already knows, the site reads
from the code: the manifest reference, the JSON Schemas, the kit catalogue, the extension points, the
plugin API version, the themes. A test fails when generated output and its source disagree. Pages a
person writes name the internal docs they were written from, and a report lists the pages whose
sources changed since someone last checked them. [Keeping the site in sync](./sync.md) has every
mechanism.

**Fast by construction.** Marketing pages ship no framework runtime. The only scripts are the theme
picker, copy buttons, install tabs, and the desktop and terminal switch, under 10 KB compressed per
page in total. No page loads anything from another origin. [Phase 2](./02-scaffold.md) adds a budget
check that fails the build when a page grows past its limit.

### Real UI, not screenshots

acorn draws its UI from a closed kit of components, and two hosts draw the same kit: the desktop in
HTML and CSS, and the terminal client in character cells. The site uses that directly. A _specimen_ is
a small piece of plugin UI written as a real plugin tree. A generator runs it through both hosts and
commits two outputs: the HTML the desktop host draws, and the cells the terminal host draws. The site
shows them side by side, styled by the app's own stylesheets, in whichever of acorn's 12 themes the
visitor picks. A test regenerates every specimen and fails when the committed output is stale, so a
kit change can't leave an old picture behind. [Phase 3](./03-specimens.md) builds this.

Whole windows, such as the landing page's picture of a task with an agent, a diff, and a terminal,
are _shell snapshots_: captured from a real running app on fixture data, then committed as sanitized
HTML. A maintainer recaptures them when the shell changes. [Phase 7](./07-shell-snapshots.md) builds
this.

This is the site's main idea. It shows the claim acorn makes about plugins, that one tree works on
both hosts, instead of describing it. It also means the docs can afford a picture for every example.

## The design pages

- [Research](./research.md): what the reference projects' sites do well, and what this site takes from
  each.
- [Site map](./site-map.md): every page, with the internal docs each docs page is written from.
- [Voice](./voice.md): how the site talks, with the words it avoids and examples.
- [Keeping the site in sync](./sync.md): every generated artifact, its source, and its check.
- [Refused](./refused.md): what the site won't build and won't say, with the reason for each.

## The phases

| Phase | What it delivers |
| --- | --- |
| [1](./01-positioning.md) | The one-line description, the landing page's story, and the decisions only the owner can make. |
| [2](./02-scaffold.md) | `apps/site` builds, deploys a preview per pull request, and holds every page in the site map as a stub. |
| [3](./03-specimens.md) | One plugin tree drawn by both hosts, committed as HTML and as cells, with a sync test. |
| [4](./04-sync-tooling.md) | Every written page names its sources, and a report lists pages whose sources changed. |
| [5](./05-wireframes.md) | Grey-box layouts for every page template, reviewed on the preview deploy. |
| [6](./06-visual-design.md) | The site's design system, built from the app's own tokens, fonts, and mark. |
| [7](./07-shell-snapshots.md) | Whole-window desktop and terminal pictures from fixture data. |
| [8](./08-landing.md) | The landing page, written and built. |
| [9](./09-feature-pages.md) | One page per feature group. |
| [10](./10-download-and-changelog.md) | The download page, the changelog, and the GitHub star count. |
| [11](./11-docs-start-and-core.md) | Docs: Start here and Using acorn. |
| [12](./12-docs-agents-security-settings.md) | Docs: agents and harnesses, security, and the settings reference. |
| [13](./13-docs-built-in-plugins.md) | Docs: one page per bundled plugin, and the plugin directory page. |
| [14](./14-docs-nodes-extension-automation.md) | Docs: Nodes, the browser extension, the CLI, workflows, schedules, and dashboards. |
| [15](./15-plugin-reference.md) | The generated plugin reference: manifest, contributions, context, bridge, and extension points. |
| [16](./16-plugin-guides-ui.md) | The plugin tutorial and a guide for every place a plugin draws. |
| [17](./17-plugin-guides-node-and-agents.md) | Guides for Node work, harnesses, model generation, data, and the browser extension. |
| [18](./18-components.md) | The shared kit: every component on both hosts, roles, layouts, icons, and themes. |
| [19](./19-search-and-agent-outputs.md) | Search, `llms.txt`, Markdown copies, social cards, and page metadata. |
| [20](./20-launch.md) | Checks, a content review, DNS, and go-live. |
| [21](./21-changelog-from-github.md) | After launch: the changelog read from GitHub releases. |

## Order and dependencies

Four tracks run side by side once the first two phases land:

- **Design:** 1, then 5, then 6. Phases 8, 9, and 10 build on the approved design. Phase 7 needs only
  phase 3, so it runs beside the design work.
- **Using acorn:** 11 to 14. These need phases 2 and 4. They can start in Starlight's default look and
  pick up the design when phase 6 lands.
- **Plugins:** 15, then 16 and 17. Phase 15 needs phase 3 for its pictures.
- **Components:** 18, after phase 3.

Phase 1 and phase 2 start together. Phase 3 is the riskiest technical work, so it starts as soon as
phase 2 has a package to put it in, and it begins with a spike. Phase 19 runs once most pages have
content. Phase 20 is last. Phase 21 can wait until after launch.

## What the owner decides

These need James before the phase that depends on them. Each has a recommendation.

1. **The license.** The repository has no `LICENSE` file, and GitHub reports no license. The site can't
   call acorn open source until it has one. `acorn-plugin-types` and `acorn-plugin-sdk` already say
   MIT in their `package.json`. Recommendation: pick a license before phase 8, because the landing page
   copy changes with the answer.
2. **The domain.** Confirm who holds `acorn.sh` and that its DNS can move to Cloudflare. The published
   schema URL depends on it.
3. **How the name is written.** The internal docs write "acorn". The browser extension writes "Acorn".
   Recommendation: a lowercase wordmark, and "Acorn" as a proper noun in sentences, which is what the
   extension and most product sites do.
4. **The star count.** The repository has six stars on October 15, 2026. A count that small reads as a
   warning, not proof. Recommendation: draw the **Star on GitHub** button everywhere, and show the
   number only above a threshold the owner sets.
5. **Analytics.** Recommendation: none at launch, or Cloudflare Web Analytics, which sets no cookies and
   needs no consent banner. Nothing that loads a third-party script.
6. **The monospace font.** The app's mono stack starts with Berkeley Mono, which needs a web license to
   serve. Recommendation: self-host JetBrains Mono, which is under the SIL Open Font License, and keep
   the app's stack as the fallback.
7. **What the download page offers first.** Signing and release delivery belong to
   [the bundle plan](../bundle.md). Until a signed release exists, the download page offers building
   from source and the standalone Node tarball, and says so plainly.

## What this programme leaves to others

- Signed builds, notarization, the updater, and release assets belong to [the bundle plan](../bundle.md).
  The download page reads whatever releases exist.
- Plugin discovery and a registry belong to [the ecosystem plan](../ecosystem/README.md). The
  `/plugins` page lists the plugins acorn bundles, and nothing else.
- Hosted Nodes belong to [the cloud plan](../cloud/README.md). The site describes what ships.

## What closes this programme

The site is live at `acorn.sh`, phases 1 to 20 are done, and `docs/site.md` (new) describes how the site
is built, regenerated, and deployed. When that's true, move anything still open to phase 21 or to a
single follow-up file, delete the rest of this folder, and update [the future index](../README.md).
