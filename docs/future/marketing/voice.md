# How the site talks

Date: October 15, 2026. Part of [the website programme](./README.md).

This page is the writing guide for every word on the site: headlines, feature copy, docs, captions,
button labels, and alt text. Read it before you write a page, and read it again before you review
one. It builds on [Write and maintain docs](../../writing-docs.md), which every docs page already
follows. Where the two disagree on a public page, this page wins.

## Who reads the site

A developer who already uses a coding agent, probably Claude Code or Codex, and is juggling more than
one piece of work at a time. They're skeptical of tools that promise to change how they work. They
read the first screen, scan the rest, and open the docs when something looks real.

Write to that person as a colleague who built the thing and is showing them around. Not a salesperson,
not a manual. Plain words, short sentences, and a reason behind every claim.

The plugin docs have a second reader: someone writing a plugin, often with an agent beside them. They
want the exact field, the exact limit, and an example they can paste. Give them that and nothing else.

## Rules

Every rule in [Write and maintain docs](../../writing-docs.md#voice) applies, plus these for public
pages:

1. **Say what it does.** "Each task gets its own Git worktree" beats "isolated workspaces for focused
   work". If a sentence could sit unchanged on another product's site, it says nothing about acorn.
   Cut it.
2. **Show it, then say it.** Put the picture next to the claim. A headline about panes sits beside a
   specimen of panes. If there's no picture, the claim had better be a fact a reader can check.
3. **Name the mechanism or the number.** "Plugins run in a Web Worker with no DOM, and the host draws
   their components" is a claim a reader can test. "Secure, sandboxed plugins" is not.
4. **One idea per heading.** A feature section answers one question. If it needs two headings, it's
   two sections.
5. **No superlatives you can't measure.** No best, fastest, most powerful, effortless, or 10x.
6. **No promises about the future.** The site describes the build that's out. No "coming soon", no
   roadmap, no "yet".
7. **Be honest about limits.** Say what acorn doesn't do in the same tone as what it does. "The desktop
   app runs on macOS and Windows. On Linux, run the terminal client." Readers trust a page that admits
   something.
8. **Address the reader as "you".** Use "we" only for the people who make acorn, and rarely.
9. **Second person, active voice, present tense.** "acorn starts a Node", not "a Node is started".
10. **Headings in sentence case, buttons as verbs.** **Download acorn**, **Read the docs**, **Copy**.

## Words the site doesn't use

On top of the list in [Write and maintain docs](../../writing-docs.md#voice):

| Don't write | Write instead |
| --- | --- |
| AI-powered, AI-native, agentic | Say what the agent does: "Claude Code runs in the task's worktree". |
| supercharge, unleash, unlock, elevate, empower | The verb that happens: run, review, merge, start. |
| seamless, effortless, frictionless | Name what's missing: "no setup", "one command". |
| blazing fast, lightning fast | The number, with how it was measured. |
| next-generation, revolutionary, game-changing | Nothing. Cut the sentence. |
| workflow, when you mean the way someone works | "how you work". Keep "workflow" for acorn's Workflows feature. |
| leverage, utilize | use |
| robust, powerful, flexible | What it handles: "keeps working when the Node restarts". |
| solution, platform, ecosystem | What it is: an app, a plugin, a Node. |
| simply, just, easily | Nothing. |
| TUI, in prose | "the terminal client". TUI is fine in a command or a code name. |

Three patterns to catch on every read:

- **"Not just X, but Y."** Say Y.
- **Groups of three for rhythm.** "Fast, focused, and fun." Use the real number of things.
- **A closing line that sums up the section.** "It's the workspace your agents deserve." Delete it.

## Names and terms

Use one term per concept, everywhere, the same one the app uses on screen.

| Term | Use it for | Not |
| --- | --- | --- |
| acorn | The product. Lowercase everywhere, including the wordmark, headings, and the start of a sentence ([owner decision 3](./README.md#what-the-owner-decides)). | Acorn, ACORN, the acorn app |
| Node | The process that holds your data and runs your agents. Capital N. | server, backend, daemon |
| desktop app | The Tauri app on macOS and Windows. | GUI, the app, Electron |
| terminal client | `acorn` with no arguments, drawn in a terminal. | TUI, CLI app |
| command line | `acorn` with a subcommand. First use: "command-line interface (CLI)". | headless client |
| browser extension | The Chrome and Firefox extension. | add-on, plugin |
| workspace, project, task | The three levels of the model, as the app names them. | job, ticket, session |
| pane | One view in a task's row, such as Changes or Database. | tab, panel, widget |
| agent session | One managed Claude Code or Codex conversation in a task. | chat, thread |
| harness | The program acorn drives to run an agent, such as Claude Code. | provider, model, runner |
| plugin | Anything that adds a feature, built in or installed. | extension, add-on, module |
| built-in plugin | Any plugin acorn ships. User docs don't care about tiers. | first-party, core plugin |
| compiled plugin, loaded plugin | Plugin docs only, defined once on "How plugins work". | tier 1, sandboxed plugin |
| kit, component | The shared set of UI components plugins draw with. | widget library, design system |
| (none) | "Specimen" and "snapshot" are the site's build terms, for code, file names, and these plans. On a page, say what the picture shows: "the Changes pane on the desktop and in the terminal". | specimen, snapshot, rendering |

## The one-line description

James chose this line on October 15, 2026, in [phase 1](./01-positioning.md#decisions):

> A workspace for working with coding agents, one task at a time.

And the paragraph under it:

> Open a task and acorn gives it a branch, a Git worktree, terminals, and agent sessions, with the diff
> and the pull request in the panes beside them. Use it from the desktop app or from your terminal.
> It's the same workspace either way.

That paragraph is the test for any other copy. If a section can't be explained in those terms, it's
probably a docs page, not a landing page section.

## Before and after

| Before | After | Why |
| --- | --- | --- |
| "Supercharge your agentic workflow with a seamless, AI-native workspace." | "Run Claude Code and Codex inside your tasks." | Says what happens. |
| "Plugins that just work, everywhere." | "A plugin's pane draws in the desktop app and the terminal client from the same code." | Names the mechanism. |
| "Enterprise-grade security." | "Agents get a token scoped to their task. They never see your GitHub or API keys." | A fact a reader can check. |
| "Blazing-fast diffs." | "The diff viewer reads pull requests up to GitHub's 3,000-file limit and loads them a segment at a time." | A number, from `docs/github-integration/mirror.md`. |
| "Coming soon: Linux." | "The desktop app runs on macOS and Windows. The terminal client runs anywhere Node.js does." | No promises, and the limit is stated. |

## The FAQ

The landing page ends with an FAQ, and the docs have the long version. Answer in two or three
sentences, from facts the internal docs state. These questions come up on every site in
[research](./research.md):

- **What does it cost?** Nothing. acorn is open source under the MIT license.
- **Do I need an API key?** No, for agents. acorn runs Claude Code and Codex with their own logins.
  API keys are optional, for features like SQL generation. `docs/security/credentials.md` says a
  harness *generate* never spends a key acorn holds; it says nothing that wide about agent sessions,
  so don't claim it for them.
- **Does my code leave my machine?** Your code stays on the machine that runs the Node. acorn talks
  to the services you connect, such as GitHub, and your agents talk to their own providers. Don't
  write "acorn sends nothing anywhere": it calls GitHub, Linear, and the rest once you connect them. Telemetry is off by default, and nothing leaves the machine unless you turn it on and add
  a destination (`docs/telemetry.md`).
- **Which platforms?** The desktop app: macOS and Windows. The terminal client and the standalone Node:
  wherever Node.js runs, Linux included.
- **How is it different from a terminal multiplexer or an IDE?** Answer with the task model: a task
  owns its branch, worktree, agents, terminals, and review, and closing it cleans all of that up.
- **Can a plugin break the app or read my keys?** Installed plugins run in a sandbox, draw only with
  acorn's components, and get only the permissions their manifest declares and you accept on each
  device (`docs/security/node-plugin-security.md`).
- **Can I run it on another machine?** Yes. Pair a remote Node and use it from the desktop app, the
  terminal client, or the command line (`docs/node-distribution.md`).

## Captions and alt text

Every specimen and snapshot has a caption that says what the reader is looking at and one thing to
notice: "The Changes pane on the desktop and in the terminal. Same plugin code, two hosts." Alt text
describes the picture's content for someone who can't see it, in a sentence. A specimen drawn as HTML
text is readable by a screen reader already, so its alt text is short, and the specimen frame carries
an accessible name.

## How to review a page

1. Read only the headings. Do they tell the story on their own?
2. Read each paragraph's first sentence. Does each one say something specific?
3. Search the page for every word in the tables above.
4. Read it aloud. Rewrite anything you wouldn't say to a colleague at your desk.
5. Ask what makes the page sound machine-written, and fix that.
