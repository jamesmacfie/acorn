# Phase 12: write the agents, security, and settings docs

Date: October 15, 2026. Status: proposed. Needs phases 2 and 4. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

## Goal

A developer knows how acorn runs their agents, what each default does and where to change it, what
acorn protects them from and what it doesn't, and what every setting in the app means. These are the
pages people open when something surprises them, so they have to be exact.

## Starting point

- The managed agents docs are 32 topic pages under `docs/managed-agents/`. The public section
  condenses them to 13 pages.
- `docs/security.md` and its topic pages describe the trust boundaries, and say what's out of scope.
- Settings has nine groups. `docs/features.md` lists every page in each. The core pages are registered
  in `packages/client-core/src/features/settings/corePages.ts`, and plugins register their own.
- No list of every setting with its default exists in one place.

## Agents

| Page | What it must cover |
| --- | --- |
| Agent sessions | Starting a session in a task, the composer, the transcript and its cards, queued turns, archive, fork, compact, import, and handing a session to the terminal. |
| Harnesses and defaults | Which harnesses ship: Claude Code, Codex, and Aider in the drawer. How acorn finds them and uses their own logins. Every default under **Harnesses and defaults**: what a new session starts on, idle stop, how long archived history is kept, terminal agent context, and **Generate with**. Harness accounts, for more than one login. |
| Permissions and approvals | Permission policy modes and what each allows. Approving and denying a request. App access for computer use. The check on changed project instructions and hidden characters, and how to approve a change. |
| Custom agents | Creating one under **Settings** > **Agents** > **Custom agents**: harness, model, effort, mode, instructions, and the tool ceiling. Starting one from **New**, the palette, or `agent_spawn`. Plugin-shipped custom agents. |
| Skills | Native skills and plugin skills, how a session loads one, and how to see which are on. |
| Delegation and subagents | Delegating to a child session in the same task or a child task with its own worktree. Reporting back. Subagent activity in the transcript. |
| Steering, queues, and follow-ups | Sending into a running turn, queueing, completion goals, and unattended follow-ups. |
| Files, attachments, and context | Attaching files and images, references to files in the worktree, and how context reaches a session. |
| Search agent history | Searching transcripts across tasks and the archive, and history retention. |
| Usage and cost | Plan usage from each provider, and what the agent cost plugin adds. |
| Agents in the terminal drawer | Raw provider sessions, run targets, and Aider. When to use the drawer instead of a managed session. |
| Agent tools and the MCP server | What acorn gives agents as tools, how a session reaches them over MCP, the task-scoped token, limits, and adding your own MCP servers. |
| Model providers and generating text | API key connections for OpenAI and Anthropic, using an installed agent command line instead of a key, the **Generate with** default, and which features generate. |

## Security

Write this section with the honesty rules in [refused](./refused.md#things-the-site-wont-say) in front of
you. Every claim names its mechanism.

| Page | What it must cover |
| --- | --- |
| The trust model | The parties: you, your devices, your Nodes, agents, and plugins. What each can reach. One diagram, as a specimen. |
| Credentials and secrets | Where credentials are stored and encrypted, why agents never see them, how a plugin borrows one without reading it, the secret detector, and the optional publication check. |
| Plugin trust and permissions | Installing on a Node, trusting a bundle on each device, what the trust prompt shows, enforced and declared permissions, updates that ask again, and removing trust. The prompt as a specimen. |
| Files, processes, and project configuration | Path confinement, the process broker, trusting `.acorn/config.toml` and workflow files, and the force push guard. |
| The preview and webviews | What the preview pane can load, why a remote Node's preview is refused, and agent browser tools. |
| The audit log | What's recorded, for how long, and where to read it. |
| Telemetry and privacy | Off by default. What each kind of record holds, what never leaves the machine, and how a destination such as Sentry is added. |
| Security diagnostics | What **Security** in Settings reports, such as disk encryption, and its limits. |
| What acorn doesn't protect against | The out-of-scope list from `docs/security.md`, in plain words. |

## Settings

The settings section has an overview and one page per group, in the app's order: General, Workspaces and
projects, Agents, Connections, Features, Automation, Machines, Plugins, and Advanced.

Each group page has a section per Settings page. Each section has a table:

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |

**Stored on** is one of device, Node, workspace, or project, as the page's header in the app says.
`docs/state-ownership/scope-rules.md` owns the rules.

The rows can't be generated: settings are components, not data. Write them by walking each page in a
`dev:agent` session. Take defaults from the code that declares them rather than from the screen, and
cite that file in `sources`.

Then add the coverage check:

1. Export a list of every core Settings page ID and every plugin Settings page ID that ships, from where
   they're registered, for tests to read.
2. Each settings group page lists the IDs it documents in its `covers` frontmatter.
3. A test fails when a registered page ID isn't in any `covers` list, or a `covers` ID isn't
   registered.

Pages under **Advanced** that exist only in development builds, such as the style gallery, are left out
and named in the test's exclusion list with the reason.

## Out of scope

Plugin settings pages beyond listing them. Each built-in plugin page in phase 13 documents its own
settings and links here.

## Acceptance

- Every page above is out of draft and cleared in phase 4's report.
- The settings coverage test passes, and fails when a fixture registers a page no docs page covers.
- Every default in a settings table matches the code at the page's `checked` commit.
- A reviewer who didn't write the security pages finds no claim without a named mechanism.
