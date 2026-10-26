---
title: Privacy policy
description: What the acorn team receives from acorn, who processes it, and how to stop it.
sources:
  - docs/integrations/sentry.md
  - docs/telemetry/plugins-and-sinks.md
  - plugins/sentry-telemetry/src/node/index.ts
  - plugins/sentry-telemetry/src/shared/settings.ts
  - plugins/sentry-telemetry/src/tree/settings.tsx
checked: '6fec87ef7'
---

This policy covers what the acorn team receives from the acorn app, who processes it for us, and how
you stop it. It doesn't cover the services you connect, such as GitHub or your own Sentry project,
or the providers your agents sign in to. Each of those has its own terms.

## What we receive

By default, nothing. acorn runs on your machine, and we run no server it reports to.

The team receives records only when you turn on both of these, under **Settings** > **Machines**, in a
release of the desktop app:

- **Collect timings, logs, and errors on this node**, under **Telemetry**.
- **Share with the acorn team**, under **Sentry export**.

With both on, your Node sends its errors, with stack traces, and one trace in twenty. A record holds a
name, a time, a few labels, the acorn version, and the error's cleaned message and stack. It never
holds prompts, agent output, file contents, diffs, terminal output, request bodies, full paths,
credentials, or your account ID ([Telemetry and privacy](/docs/security/telemetry-and-privacy/#what-never-leaves-the-machine)).
Records come only from acorn itself and the plugins it ships, unchanged. A plugin you installed or
edited sends nothing to us.

We use the records only to find and fix bugs in acorn, and we don't sell or share them.

## Who processes it

[Sentry](https://sentry.io), run by Functional Software, Inc., receives and stores the records for us.
Sentry stores them in the data region chosen for the acorn team's Sentry organization, and keeps them
for the retention period of that organization's plan. Sentry's own
[privacy policy](https://sentry.io/privacy/) covers how it handles them.

When your Node sends a record, Sentry also sees the connection it came from, such as your IP address,
as any web service does.

## How to stop it

Turn off **Share with the acorn team** or **Collect timings, logs, and errors on this node**. acorn
stops sending within seconds and drops anything it hadn't sent. Connecting your own Sentry project or
setting `ACORN_SENTRY_DSN` also stops it, because your own destination takes priority.

To ask about records already sent, open an issue on [GitHub](https://github.com/jamesmacfie/acorn).
