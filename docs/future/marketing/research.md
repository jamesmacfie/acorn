# What the reference sites do well

Date: October 15, 2026. Part of [the website programme](./README.md).

This page records a survey of the sites behind the projects in `references/`, read on October 15,
2026, and what this site takes from each. Read it before phase 5 or phase 6, and before you argue for
a pattern the site doesn't use. Sites change, so treat a quoted line as true on that date only.

Seven of the projects keep their site in the repository, and five of those use Astro. The vendored
copies show how they're built, not only what they look like:

| Project | Site source | Built with |
| --- | --- | --- |
| hunk | `references/hunk/website/` | Astro and Starlight, static |
| opentui | `references/opentui/packages/web/` | Astro with its own docs layout |
| opencode | `references/opencode/packages/web/` | Astro, Starlight, and Solid |
| t3code | `references/t3code/apps/marketing/` | Astro, hand-written pages |
| flue | `references/flue/apps/www/` and `references/flue/apps/docs/` | Astro and Tailwind, Pagefind |
| gh-dash | `references/gh-dash/docs/` | Astro and Starlight |
| cmux | `references/cmux/web/` | Next.js |

## The sites, one at a time

### herdr.dev

The strongest landing page in the set for a product like acorn. The hero is a mono eyebrow ("the agent
runtime"), a large headline ("Run them anywhere. Leave them running."), two sentences of plain
explanation, and a one-line `curl` install with a copy button. Under it, a strip of four numbers.

Then the thing worth copying: a picture of the product built from HTML text, with a sidebar of
workspaces and agents you can click. The caption says "Click the sidebar, it's a real layout." The
picture is the product's own shape, not a screenshot. Each feature below gets a number, a short
heading, a paragraph, and a small drawn visual. The site has an **Ink** and **Paper** theme switch.

The docs landing offers a prompt to paste into your agent: "Help me understand and set up Herdr. Read
https://herdr.dev/agent-guide.md first, then walk me through it step by step." The plugin directory
lists community plugins from a GitHub topic and says "Listings aren't reviewed by Herdr, so install at
your own discretion."

Take: the clickable product picture, the install line in the hero, the honest wording on unreviewed
plugins, and the agent guide. Skip: the funding banner, and counts acorn doesn't have.

### hunk.dev

The best plumbing in the set, and its Astro config is the starting point for phase 2. The hero has
tabbed install commands (curl, Homebrew, npm, mise, Nix) with a copy button, and a version pill that
links to that release's changelog. Each feature section ends with a link into the docs.

Under the hood:

- `starlight-dot-md` serves every docs page as Markdown at the same URL plus `.md`.
- `starlight-llms-txt` publishes `/llms.txt`, `/llms-small.txt`, and `/llms-full.txt`, with a short
  "Notes for agents" block that holds only rules no page states.
- The changelog is generated from the repository's `CHANGELOG.md` into committed pages, with a
  `--check` mode that gates CI and an RSS feed. Release dates live in a committed file, so the build
  needs neither Git nor the network.
- Social cards are drawn by Playwright as a maintainer task, never during the site build.
- `website/MEDIA.md` says how every image and clip is regenerated.
- Playwright smoke tests and axe accessibility checks cover the marketing pages, docs, and changelog.

Take: all of the above. Skip: video clips, because acorn's pictures are rendered.

### opentui.com

The terminal-rendering pattern this site needs. A script draws real terminal UI with opentui's own
renderer, headless, and writes the frames to `src/data/doc-visuals.json` as rows of text spans with
color intents. An Astro component draws that as HTML text. A test regenerates the file and fails if it
differs from the committed copy. Recordings of terminal sessions are frames of JSON, not video. A
second script type-checks every code block in the docs against the current packages.

Take: frames as committed JSON, drawn as HTML, with a regenerate-and-compare test. Take: type-checking
the docs' code blocks. Skip: a hand-built docs layout, because Starlight covers it.

### posting.sh

The whole landing page is drawn as the app: a numbered pane per section, a key-hint bar along the
bottom with a mode badge, and a theme picker that offers the app's own themes. It reads as a terminal
product from the first frame.

Take: a theme picker made of the product's real themes, and keyboard hints that match the app. Skip:
turning the page into a pretend terminal. Docs have to read like docs, and a page that fakes a TUI
fights the browser's own keyboard and screen reader behavior.

### opencode.ai

The hero says "The open source AI coding agent", then install tabs, then a short section that names
its three clients: terminal, IDE, and desktop. A "What is OpenCode?" section gives seven one-line
cards. A short privacy section says what it doesn't store. An FAQ closes the page.

Take: naming every client in the first scroll, and a privacy section that states facts. Skip: the
email waitlist.

### paseo.sh

The closest product to acorn's architecture. Its "Run it anywhere" section explains a daemon with many
clients in one paragraph: the desktop app bundles the daemon, the daemon can run headless, and any
client can connect. Its FAQ answers whether using your own agent subscriptions risks your account. The
hero mockup is built from the product's own UI, with a phone beside the desktop.

Take: the one-paragraph daemon-and-clients explanation, which acorn's Node needs, and an FAQ that
answers the subscription question directly. Skip: comparison pages at launch ([refused](./refused.md)).

### onorca.dev

An agent IDE with as many features as acorn. Its tour is a tabbed panel: Workspaces, Orchestration,
Browser, Terminal, Tasks, Editor, Notes. Each tab swaps one picture and one paragraph. That keeps a
long feature list to one screen.

Take: the tabbed tour for a product with many features. Skip: headline claims like "Ship 100x", which
[voice](./voice.md) rules out.

### cmux.com

A plain feature list with a bold label per line, then an FAQ that answers the comparison everyone asks
("how is this different from tmux?") in prose. Testimonials come from named people.

Take: answering the obvious comparison question in the FAQ instead of on a comparison page. Skip: the
paid edition upsell.

### frink.dev

Its "How Flows work" section explains triggers, conditions, and approvals with one diagram of a real
flow. Take: explain workflows with a drawn graph. acorn's kit has a `Graph` node, so the picture can be
a specimen.

### gh-dash.dev

A config snippet sits beside the terminal picture it produces. Take: this is the plugin docs pattern.
A manifest entry beside the specimen it draws.

### yazi-rs.github.io

The plugin docs explain the mental model first, then split the API reference by topic. Every code
block starts with a comment naming the file it goes in. Mistakes get their own blocks, labeled as
wrong, with the fix beside them. Take: all three, for the plugin guides.

### ratatui.rs

A showcase of real apps built with the library, and a docs section of short recipes. Take: recipes as
a shape for the plugin guides. The showcase waits until there are third-party plugins to show.

### bb

`references/bb/apps/web/` publishes JSON Schemas at stable URLs that name themselves in `$id`, and
teaches its plugin system through small example plugins, one per capability, each with a README.
acorn's schema already names itself, and phases 16 and 17 take the example plugins.

## What the survey settles

1. Astro is the default for this kind of site. Five of seven in-repo sites chose it.
2. Show the product in its own medium. The two sites that do it best, herdr and posting, build the
   picture from text and CSS rather than images. acorn can go further, because its pictures can come
   from its real components.
3. Put install in the hero, and repeat it at the bottom of the page.
4. Name every client early. acorn has four: desktop, terminal, command line, and browser extension.
5. Generate what the code knows, commit it, and fail a test when it's stale. herdr, hunk, and opentui
   all do this for their config reference, changelog, or pictures.
6. Answer the hard questions in an FAQ, in plain words: cost, privacy, your agent subscriptions, and
   how it compares to what the reader already uses.
7. Write down how every asset is regenerated, beside the site.
