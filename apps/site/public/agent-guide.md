# Help someone start with acorn

This guide is for a coding agent helping a person install acorn, pair a device, and open their first
task. acorn is a workspace for working with coding agents, one task at a time.

The docs are written for the person, and each step below names the page that owns it. Read that page
before you act on the step. Every docs page is also Markdown at its URL plus `.md`, as the links here
are. Where this guide and a page disagree, the page is right.

## 1. Install acorn

Read [Install](https://getacorn.dev/docs/start/install.md). It covers what each way of running acorn
needs, building from source, the desktop app, the terminal client and the command line, and the
first-run setup. The [download page](https://getacorn.dev/download/) says whether there's a release to
download.

- Ask the person which machine acorn runs on, and whether they want the desktop app, the terminal
  client, or both. [Desktop and terminal](https://getacorn.dev/docs/start/desktop-and-terminal.md) says
  how the two differ.
- You can run the commands on Install for them. The first-run setup is in the app's window, so walk
  the person through its steps rather than doing them.
- Agents need Claude Code or Codex installed and signed in on the machine that runs the Node. Install
  says so under **What you need**.

## 2. Pair a device

Skip this step when the person uses only the desktop app on one computer.

- The terminal client asks to pair with the desktop app's Node the first time it runs.
  [Desktop and terminal](https://getacorn.dev/docs/start/desktop-and-terminal.md) has the steps.
- For a Node on another machine, read [Run a standalone Node](https://getacorn.dev/docs/nodes/run-a-standalone-node.md),
  then [Pair a device or a remote Node](https://getacorn.dev/docs/nodes/pair-a-device-or-a-remote-node.md).
- Pairing shows the Node's identity words in two places. Ask the person to compare them. Don't
  compare them for the person, because the words are how the person knows the Node is theirs.

## 3. Open their first task

Follow the [quick start](https://getacorn.dev/docs/start/quick-start-first-project-first-task-first-agent.md).
It adds a project, opens a task, runs an agent session, and commits, pushes, and archives the change.
It needs a Git repository with a remote the person can push to. Its **In the terminal** section has
the same steps for the terminal client.

[Concepts](https://getacorn.dev/docs/start/concepts.md) explains workspaces, projects, tasks, and panes,
if the person asks what they're looking at.

## For anything else

- [/llms.txt](https://getacorn.dev/llms.txt) lists the docs, and
  [/llms-full.txt](https://getacorn.dev/llms-full.txt) holds all of them in one file.
- The [command line reference](https://getacorn.dev/docs/reference/command-line-reference.md) lists every
  `acorn` command and its options.
