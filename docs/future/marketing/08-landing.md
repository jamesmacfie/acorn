# Phase 8: build the landing page

Date: October 15, 2026. Status: proposed. Needs phases 1, 6, and 7.

## Goal

The page at `/` tells a developer what acorn is in five seconds, shows it in thirty, and gets it onto
their machine in three minutes. Every claim on it is something the reader can check: a picture, a
number, or a link to the docs page that explains it.

## Starting point

- Phase 1 chose the eyebrow, the headline, the paragraph under it, and the order of sections.
- Phase 6 built the components. Phase 7 captured the snapshots.
- [Voice](./voice.md) has the rules, the words to avoid, and the FAQ facts.
- [Research](./research.md) has the patterns this page takes: herdr's hero and product picture, hunk's
  install tabs, orca's tabbed tour, paseo's explanation of a daemon with many clients, gh-dash's config
  beside its result, and opencode's privacy section.

## The page from top to bottom

Phase 1 confirms or reorders this outline. Write each section's copy to [voice](./voice.md), with every
claim linked to the docs page that owns it.

1. **Hero.** The eyebrow, the headline, and the paragraph. A primary action: **Download** when a release
   exists, **Get acorn** pointing at `/download/` when it doesn't. A secondary action, **Read the docs**.
   One line under the actions names the clients: the desktop app for macOS and Windows, the terminal
   client, the command line, and the browser extension.
2. **The picture.** The hero snapshot, full width, with **Desktop** and **Terminal** tabs. Caption: the
   same task in both clients. If phase 7 captured variants, clicking a task in the rail swaps the
   scene.
3. **How it works, in three steps.** Each step is a heading, two sentences, and a small specimen:
   - Open a task. It gets a branch, and a worktree the first time it needs files.
   - Run agents in it. Claude Code and Codex sessions with approvals, queued turns, and delegation.
   - Review and ship. The diff, the pull request, and merge, then archive the task and acorn cleans up.
4. **The tour.** A tabbed panel, one tab per feature group in phase 1's ranking. Each tab has one
   snapshot, one paragraph, and a link to its feature page.
5. **Two clients, one workspace.** A plugin pane as a specimen on both hosts, side by side, with the
   point stated plainly: the desktop app and the terminal client draw the same components, so a plugin
   written once works in both.
6. **Add what's missing.** A plugin manifest entry beside the pane it draws. A short list of what a
   plugin can add, each linked to its guide. One line on asking your agent to write the plugin, since
   acorn's agents can read the plugin vocabulary from your Node.
7. **Your machine, your keys.** Four facts, each linked: agents get a token scoped to their task and
   never see your credentials; credentials are encrypted at rest and left out of backups; installed
   plugins run sandboxed and get only the permissions you accept on each device; telemetry is off by
   default.
8. **Run it anywhere.** One paragraph: the desktop app runs a Node on your machine, and you can pair
   others, including a standalone Node on a server, and use them from any client. A small snapshot of
   Fleet home.
9. **FAQ.** The questions in [voice](./voice.md#the-faq), answered in two or three sentences each, in
   `<details>` elements so they work with no script.
10. **Install again.** The install block repeated, with **Read the docs** beside it.
11. **Footer.**

## Build notes

- The page ships the scripts for the tabs, the copy buttons, the appearance picker, and, if used, the
  hero swap. Nothing else. With scripting off, every tab's panel shows in order and the copy buttons
  hide.
- Tabs follow the WAI-ARIA tabs pattern, with arrow keys moving between tabs.
- The headline is real text, never an image. The snapshot is HTML, so its text is searchable and
  readable by a screen reader. Give the snapshot frame an accessible name and keep the caption short.
- No social proof that isn't true. The star button follows [owner decision 4](./README.md#what-the-owner-decides).
  No logos of companies, no testimonials until there are real ones with permission to quote.

## Out of scope

Feature pages, the download page, and the docs. This page links to them.

## Acceptance

- The five-second test from phase 1, repeated on the built page with five new people, gets the same or
  better results than the mockup did.
- Every claim on the page links to a docs page, and every docs page it links to exists and isn't a
  draft.
- Lighthouse reports performance of at least 98 on mobile and 100 for accessibility. Record the numbers
  and the date in the site's internal page.
- The page passes the budget check with the snapshot included.
- The voice review checklist passes, and James approves the copy.
