---
title: Telemetry and privacy
description: acorn's telemetry is off by default. What a record holds when it's on, what never leaves the machine, and how to send it to Sentry.
sources:
  - docs/telemetry.md
  - docs/telemetry/model.md
  - docs/integrations/sentry.md
  - plugins/sentry-telemetry/src/tree/settings.tsx
  - plugins/sentry-telemetry/src/shared/settings.ts
checked: 'c69c132e2'
---

This page covers acorn's telemetry: the timings, logs, and errors it can collect about itself, the
switch that's off by default, what a record holds, what never leaves your machine, and how to send
records to your own Sentry project. acorn has no telemetry server of its own.

## Off by default

Telemetry has one switch per Node: **Collect timings, logs, and errors on this node**, under
**Settings** > **Machines** > **Telemetry**. It's off until you turn it on.

Even on, nothing leaves the machine unless a plugin that sends records somewhere, called a _sink_, is
installed and set up. acorn ships one sink, **Sentry export**, and it sends nothing until you connect a
Sentry project. With the switch off, nothing is collected at all.

The page's **What this node has collected** counts records since the Node started, without showing the
records themselves, and says where they're sent.

## What a record holds

The Node collects records from itself, the desktop app, the terminal client, and the app's helper, in
five kinds:

| Kind | What it is | Example |
| --- | --- | --- |
| Span | Something that started because someone asked, and ended with the answer | An HTTP request, a schedule run |
| Log | A line acorn or a plugin wrote | `[schedules] github:refresh timed out` |
| Event | Something that happened, with no duration | A cache miss |
| Metric | A count or timing, summed over five seconds | Git commands run, SQL statements |
| Error | A name, a cleaned message, and sometimes a stack | A route failure, a crash |

Each record holds a name, a time, and a few labels, such as which plugin or pane caused it and whether
it worked. Every record names its owner, `core` or a plugin's ID, so a slow request points at whoever
caused it.

## What never leaves the machine

A record never holds:

- Prompts, agent output, file contents, diffs, or terminal output.
- Request or response bodies, query text, or what a WebSocket carried.
- Full paths. Your home folder becomes `~` and acorn's data folder `<data>`.
- Credentials. A cleaner removes known token shapes and control characters from every label and
  message, and caps each at 2,000 characters.
- Your account ID.

Pattern cleaning catches known credential shapes, not every possible secret. Code that knows it holds a
secret leaves it out of the record before the cleaner ever sees it.

## Send telemetry to Sentry

1. Turn on **Collect timings, logs, and errors on this node** under **Settings** > **Machines** >
   **Telemetry**.
2. Open **Settings** > **Connections** > **Services**, click **Add connection**, and pick Sentry. Paste
   the project's DSN, and optionally an environment and a release. acorn checks the DSN with Sentry
   before it saves it.
3. Open **Settings** > **Machines** > **Sentry export** to choose what goes.

| Setting | What it sends | Default |
| --- | --- | --- |
| **How many traces to send** | The share of traces sent | Every trace |
| **Errors** | Errors, as Sentry issues | On |
| **Traces** | Requests, commands, page changes, and schedule runs | On |
| **Logs** | Log lines from acorn and its plugins | On |
| **Metrics** | Counts and timings | On |
| **Events** | One-off events, as info logs | On |
| **Stack traces on errors** | Stacks, with your home folder replaced by `~` | On |
| **Task ids as tags** | A task's ID, never its contents, so an issue links to its task | On |

A DSN can only send to its project. It can't read anything back, so acorn asks for nothing wider. The
DSN is stored like any other credential, and the plugin borrows it for each send without holding it
([Credentials and secrets](/docs/security/credentials-and-secrets/)). Disconnecting stops the export
within five seconds.

A sink sees every record from every part of acorn and every plugin, so its trust prompt marks that
grant as broad.

## Other ways your data leaves the machine

Telemetry is one path. The others are the services you connect and the agents you run:

- acorn talks to GitHub, Linear, Rollbar, and the other services you connect, for what you asked of
  them.
- Your agents talk to their own providers, with their own logins.
- A Generate control sends what it needs to the backend you picked.
- A plugin you install can reach the hosts its trust prompt lists.

## In the terminal

The terminal client posts its records to the Node, which applies the same switch. **Telemetry** opens
in the desktop app, and **Sentry export** isn't listed in the terminal client's Settings.

## Limits

- The switch is per Node. Each Node you pair keeps its own.
- **Sentry export** holds one Sentry connection. To send to another project, replace its DSN.
- A record can still hold a repository-relative path, such as a file name a log line names.
