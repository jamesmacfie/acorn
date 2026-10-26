# Phase 4: ship the DSN in release builds

Date: October 26, 2026, from the October 17, 2026 plan. Status: not started. Depends on
[phase 1](./01-dsn-from-the-environment.md).

## Goal

A tag build carries the team's DSN. A dev build and a fork carry none. Nothing leaves someone's
machine unless they turn on a switch that says the records go to the acorn team, and what goes is
sized for many installs.

These steps ship together. A release build must not carry the DSN without the consent switch, the
fixed policy, and the privacy docs.

## The DSN

A DSN can only write to one project and can't read anything back. Don't follow the GitHub client
id's pattern of a default in the source, because then every fork and every dev build would report to
the team's project.

1. Add a repository secret, `ACORN_SENTRY_DSN`.
2. In `build-desktop.yml`, pass it to the desktop build step as `ACORN_SENTRY_RELEASE_DSN`. Only that
   workflow sets the name.
3. `build-plugin.mjs` writes `ACORN_SENTRY_RELEASE_DSN` into the `sentry-telemetry` bundle as a
   compile-time constant. Every other build gets an empty string.
4. `target()` resolves in this order: the Settings connection, then `ACORN_SENTRY_DSN` from the
   environment, then the built-in DSN when both consent switches are on.
5. With the built-in DSN, set release to `acorn@<batch.version>` and environment to `production`.

## Consent

Collecting records locally and sending them to someone else are separate decisions. The existing
switch means the first one.

Add **Share with the acorn team** to the Sentry export settings page. Show it only when the build
carries a DSN and neither a Settings connection nor `ACORN_SENTRY_DSN` is in use. It's off by
default. The copy names what goes (errors and sampled traces), what never goes (the list on the
privacy page), and where it goes (Sentry, in the project's region).

Turning the switch off discards the queue at the next attempt, as disconnecting does.

## Fixed policy

`DEFAULT_SETTINGS` assumes one person's data. With the built-in DSN, ignore the settings page and use
this:

| Kind | Built-in DSN |
| --- | --- |
| Errors | On, with stacks |
| Traces | On, sampled at 0.05 |
| Logs | Off |
| Metrics | Off |
| Events | Breadcrumbs on errors only |
| Task ids as tags | Off |

Tune the sample rate after a week of real volume.

In Sentry, turn on spike protection and set a rate limit on the client key. That's the real cost
cap, because a client can't be trusted to limit itself. The exporter already honours
`X-Sentry-Rate-Limits`.

## Docs

- `apps/site/src/content/docs/docs/security/telemetry-and-privacy.md`: the first paragraph, which says
  acorn has no telemetry server of its own, the new switch, and the fixed policy.
- `docs/telemetry/plugins-and-sinks.md` and `docs/integrations/sentry.md`: the built-in fallback and
  the resolution order.
- A privacy policy on the site that names Sentry as the processor and the data region. Sentry sets
  the region when the organization is created, so choose it first.

## Acceptance

- A tag build with both switches on sends a test error to the team's project, tagged `production`.
- With collection on and **Share with the acorn team** off, nothing reaches the team's project.
- `pnpm --filter @acorn/desktop run build` with `ACORN_SENTRY_DSN` in the shell produces a bundle with
  no DSN in it.
- A Settings connection or `ACORN_SENTRY_DSN` sends there and nothing to the team's project.
