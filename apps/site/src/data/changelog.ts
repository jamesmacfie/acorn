// What changed in acorn, newest first, for the changelog page and its feed. Written by hand from
// docs/release-notes.md for people who use acorn; the changelog page's `meta` cites that file, so the
// staleness report lists the page when the notes change. Every page that imports this checks it, so a
// malformed entry fails the build.
import { z } from 'astro/zod'

const entry = z.object({
  /** The day it changed, as YYYY-MM-DD. It's the entry's anchor on the page, so no two entries share one. */
  date: z.iso.date(),
  version: z.string().min(1).optional(),
  title: z.string().min(1),
  /** One paragraph. */
  summary: z.string().min(1),
  changes: z
    .array(z.object({ kind: z.enum(['added', 'changed', 'fixed', 'removed']), text: z.string().min(1) }))
    .min(1),
  /** What a plugin author has to do, when the entry changes the plugin API. */
  plugins: z.string().min(1).optional(),
})

const entries = z
  .array(entry)
  .refine((all) => all.every((item, index) => index === 0 || item.date < all[index - 1].date), {
    message: 'Entries go newest first, one per day.',
  })

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char])

/** An entry's text as HTML: escaped, with each `backticked` span as code. */
export const textToHtml = (text: string) =>
  escapeHtml(text).replace(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`)

export const changelog = entries.parse([
  {
    date: '2026-10-12',
    title: 'Browser rules leave project settings',
    summary:
      'Project settings no longer offer browser rules. Plugins move to plugin API 5, which drops the browser rule types and the old names for extension points.',
    changes: [{ kind: 'removed', text: 'Browser rules in project settings.' }],
    plugins:
      'Plugin API 5 removes the `BrowserRule` type, `ProjectConfig.browserRules`, and the `preview.rules` capability. Plugin API 4 removes `open`, `contribute`, and `entries` from `ctx.extensionPoints`: call `declare`, `handle`, and `handlers` instead. A plugin that uses none of these needs only a manifest range that covers 5, such as `"4 || 5"`.',
  },
  {
    date: '2026-10-02',
    title: 'Read, edit, and import what agents remember',
    summary:
      'The Memory page lists, searches, edits, deletes, and restores the memories agents save, and shows each memory’s history. Memory is now Markdown files, in your private folder and in each project’s.',
    changes: [
      { kind: 'added', text: 'The Memory page, with search, editing, restore, and each memory’s history.' },
      {
        kind: 'added',
        text: 'Import a folder of Claude memory files. acorn shows what it will import first, and you choose to skip or overwrite each memory that already exists.',
      },
      {
        kind: 'changed',
        text: 'Memory reads and searches Markdown files in your private folder and the selected project’s folder. acorn doesn’t read a repository’s `.acorn/memory` folder.',
      },
      {
        kind: 'removed',
        text: 'The Findings plugin, review settings, review notices, and archive capture. acorn leaves `plugins/findings.sqlite` and `plugins/memory.sqlite` on disk and doesn’t open them, so you can delete them once you’ve kept any review records you want.',
      },
    ],
    plugins:
      'Plugin API 3 removes `terminal.reviewInput.v1` and `workflows.reviewInput.v1`. Rebuild installed plugins with a manifest range that covers 3.',
  },
  {
    date: '2026-09-24',
    title: 'The first build',
    summary:
      'The desktop app for macOS and Windows, the terminal client, the `acorn` command line, and the standalone Node, all working on the same workspaces, projects, and tasks.',
    changes: [
      {
        kind: 'added',
        text: 'Workspaces, projects, and tasks. A task can own a branch, a Git worktree, a pull request or issue, panes, terminals, and agent sessions. Archived tasks can be searched and restored.',
      },
      {
        kind: 'added',
        text: 'Claude Code and Codex agent sessions in a task. An agent can hand work to a child session, which reports back.',
      },
      { kind: 'added', text: 'GitHub review: diffs, comments, reviews, labels, reviewers, checks, and Actions logs.' },
      {
        kind: 'added',
        text: 'Task panes for notes, memory, context, Docker, PostgreSQL, HTTP requests, Linear, and Rollbar.',
      },
      { kind: 'added', text: 'Workflows, written in the app or loaded from a TOML file in the repository.' },
      {
        kind: 'added',
        text: 'Nodes: pair another machine’s Node, see every Node in the Fleet view, and turn plugins on or off per Node.',
      },
      { kind: 'added', text: 'Backup, configuration import, a 90-day audit trail, and security settings.' },
      {
        kind: 'added',
        text: 'The `acorn` command line, which manages workspaces, projects, tasks, agents, workflows, and runs on a paired Node.',
      },
    ],
    plugins:
      'Every pane is one of eight layouts the host draws, filled with components from one kit. A loaded plugin draws the same components from a Web Worker with no DOM. `npm create acorn-plugin` scaffolds a plugin.',
  },
])
