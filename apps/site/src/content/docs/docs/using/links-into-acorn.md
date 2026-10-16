---
title: Links into acorn
description: Copy an acorn:// link to a task, a pane, a page, or Settings, and open one in the desktop app or the terminal client.
sources:
  - docs/frontend/acorn-links.md
  - docs/tui/process.md
  - docs/panes.md
  - apps/desktop/src-tauri/tauri.release.json
  - apps/desktop/scripts/dist.mjs
checked: 90ded85ca
---

This page covers `acorn://` links: what one can point at, how to copy one, and how to open one in the
desktop app or the terminal client. Use them to keep a task in a note, a ticket, or a chat message.

## What a link can point at

| Link | Opens |
| --- | --- |
| `acorn://<node>/t/<task>` | A task |
| `acorn://<node>/t/<task>?pane=<pane>` | A task, on one of its panes |
| `acorn://<node>/p/<project>` | A project, or a page under it, such as a plugin's view |
| `acorn://<node>/settings/<page>#<section>` | A Settings page, at a section |
| `acorn://<node>/source/<source>` | A source in the left rail |
| `acorn://<node>/open?url=<address>` | The task or pane that a web address belongs to, such as a pull request's |
| `acorn://<node>/new-task?url=<address>` | The task for a web address, or a dialog to create one |

`<node>` is the ID of a Node, or `local` for the Node on this computer. A link names the exact Node, so
someone who opens it on another device reaches the same Node, if their device is paired with it.

A link only moves you somewhere, or opens a dialog that asks first. It never runs a command, sends a
prompt, or starts a workflow, and it carries no credentials. Opening one doesn't pair your device with
a Node or trust a plugin.

## Copy a link

Any of these copies a link to what's in front of you:

- Run **Copy link** from the command palette.
- Right-click a task or a source in the left rail and choose **Copy link**. This copies the one you
  clicked, even when another is open.
- On a project's page, choose **Copy link** from the top bar's menu.
- In Settings, use **Copy link** in the page's header. While Settings is open, its page wins over the
  task underneath.

A task's link includes the pane that has focus. acorn says the link was copied only once it's on the
clipboard.

## Open a link in the desktop app

Click an `acorn://` link anywhere on the computer, and the desktop app opens it, whether it was running
or not. Only the packaged app, built with `pnpm dist`, registers `acorn://` with the operating system.
A desktop app run from a checkout with `pnpm dev` doesn't, so a link clicked elsewhere doesn't reach it.

If the link names a Node this device isn't paired with, or a place that doesn't exist, the app says so
in a notice. A link to a plugin page that's gone opens the project instead, and a link to a pane that's
gone opens the task.

A `new-task` link opens the task if one already exists for that address. If not, it shows the dialog
for creating a task from it, and nothing is created until you confirm.

## In the terminal

Start the terminal client on a link:

```sh
acorn --link 'acorn://local/t/<task>?pane=agents'
```

The terminal client checks the link before it connects, and opens the task, project, source, or
Settings page it names. It can't scroll to a Settings section, and a page with no terminal view opens
its project with a notice. It can't use `--node` or `--task` beside `--link`, and it can't follow a
`new-task` link: creating a task from a link needs the desktop app's confirmation dialog. When the
terminal has no clipboard access, **Copy link** shows the link for you to copy by hand.

## Limits

- Links work only for devices already paired with the Node they name.
- A link to a plugin's page can stop working when the plugin renames or removes that page. Links to
  tasks, projects, sources, and Settings are stable.
- A link is at most 4,096 characters.
