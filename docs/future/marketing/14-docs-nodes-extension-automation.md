# Phase 14: write the Nodes, browser extension, automation, and reference docs

Date: October 15, 2026. Status: proposed. Needs phases 2 and 4. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

## Goal

A developer can run acorn on another machine, connect the browser extension, automate work with
workflows and schedules, script acorn from the command line, and look up any shortcut, file, or
environment variable. These are the docs for people who've used acorn for a week and want more from it.

## Nodes and devices

| Page | What it must cover |
| --- | --- |
| Nodes | What a Node owns and what a client owns, in a picture. The Node the desktop app runs for you. Why there's no shared database between Nodes. |
| Pair a device or a remote Node | Advertising a Node, pairing from the desktop app, the terminal client, and the command line, comparing the six identity words, and what a device token can do. |
| Run a standalone Node | The tarball, its environment variables, `acorn node start --background`, `status`, and `stop`, running it as a service, and which plugins it has. |
| The fleet view | Fleet home, Node labels, attention and search across Nodes, and offline and partial states. |
| Where your data lives | The data folder, `node.json`, what each database holds, and what's on your device instead. |
| Back up and restore | Making a backup, what it leaves out and why, and restoring into a fresh data folder. |

## Browser extension

| Page | What it must cover |
| --- | --- |
| Set up the extension | Installing the bridge with `acorn browser install`, loading the extension in Chrome or Firefox, pairing, the permissions the browser asks for and why, and every sidebar state with its next step. |
| Talk to an agent from the browser | Opening a task's conversation, sending, and retries. |
| Send pages, selections, and screenshots | Each capture, page access, and where the attachment lands. |
| Ask about an element | The element picker and what it sends. |
| Task chips and handoffs | The chip a plugin draws on a site, the handoff card, and creating a linked task. Matching a page to its task, and Home's **This page** section. |
| Project sites | Tying web addresses to a project, and overrides. |
| Workflows and plugin panels | Starting a workflow from the sidebar, and a plugin's read-only panel. |
| Waiting requests and notifications | The toolbar badge, the waiting list, and operating system notifications. |

Pictures for these pages come from the extension's own sidebar markup. Its tests already mount the
sidebar under jsdom, so add the sidebar to phase 3's pipeline as a third host, using the extension's
built stylesheet.

## Automation

| Page | What it must cover |
| --- | --- |
| Workflows | What a workflow is, a run, a step, and a gate, with a run drawn as a `Graph` specimen. |
| Write a workflow | The two homes for a definition: `.acorn/workflows/*.toml` in a repository and definitions written in the app. The editor. Generating a draft with a model. Exporting to a file. A field reference for the TOML format, generated from the workflow definition schema in the workflows plugin's contract, with a test that every field has a description. |
| Steps, gates, and budgets | Every built-in step kind with an example, typed step output and conditions, waiting on other steps, joins, budgets, polling gates, retries, and child workflows. |
| Start and schedule runs | Starting from the palette, from an item such as a pull request, from the command line, and on a schedule. |
| Schedules | Plugin schedules and your own, the 300-second floor, consent, and the run history. |
| Dashboards | Panels over data sources, the editor, placements, sampling, trends, and starter panels from plugins. Panel specimens. |
| Data sources and saved queries | What a typed source is, scope and reach, the workspace query library, and derived sources. |
| The command line | Selecting a Node, reading resources, writing workspaces, projects, and tasks, agent sessions, workflow runs, plugin commands, output formats, and exit codes. |

## Reference pages

| Page | How it's made |
| --- | --- |
| Command line reference | Every command and its options. The command line has no declarative command table. Its help text comes from `helpFor` in `apps/cli/src/args.ts`. At build, run the built command line with `--help` for each command and render the output, so the page can't disagree with the binary. The site may run another app's binary. It may not import its source. |
| Keyboard shortcuts reference | Every default chord, with what it does and where it works, generated from the default keymap and command catalog. Find the module that registers the defaults, export the table for tests if it isn't already, and render it. |
| Configuration files | `.acorn/config.toml`, `.acorn/workflows/*.toml`, and the device config file, with the field reference for each. The device config reference renders `acorn-device.schema.json`. |
| Environment variables | Every variable a person sets, such as `ACORN_DATA_DIR`, `ACORN_PORT`, `ACORN_ADVERTISE_HOST`, and `ACORN_TUI_NOTIFY`, with what each does. A test greps the Node, the command line, and the terminal client for `ACORN_*` reads and fails on any variable the page doesn't list or explicitly excludes as internal. |
| JSON Schemas | The four published schemas, with their URLs and how to point an editor at each. |
| Glossary | Every term in [voice](./voice.md#names-and-terms), defined in one or two sentences, linked to its page. |

Publish the command line's output schemas at `/schemas/cli/`, copied from `apps/cli/schemas/` at build.

## Out of scope

Writing a workflow step kind, a schedule, or a data source in a plugin. Those are plugin guides in
[phase 17](./17-plugin-guides-node-and-agents.md).

## Acceptance

- Every page above is out of draft and cleared in phase 4's report.
- The command line reference updates when a command's help text changes, with no edit to the site.
- The environment variable test passes, and fails when a fixture reads an undocumented variable.
- Someone pairs a second Node and the browser extension from these pages alone.
