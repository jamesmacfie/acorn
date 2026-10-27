# Phase 4: ship the DSN in release builds

Date: October 26, 2026, from the October 17, 2026 plan. Status: done. Depends on
[phase 1](./01-dsn-from-the-environment.md).

## Completion note

Landed on October 26, 2026.

What landed:

- `build-desktop.yml` declares an optional `ACORN_SENTRY_DSN` secret, and `ci.yml` passes it in. The
  **Build the bundle inputs** step sets `ACORN_SENTRY_RELEASE_DSN` from it for `v*` tags only.
- `build-plugin.mjs` defines `__ACORN_SENTRY_RELEASE_DSN__` for the `sentry-telemetry` node bundle
  only. It's the trimmed variable or an empty string. Source run from a checkout has no constant, so
  the plugin checks `typeof` first, the way `ACORN_BUILD` does.
- `target()` resolves a connection, then `ACORN_SENTRY_DSN`, then the team's DSN when the build
  carries one and the `share` preference row holds `true`. The team target carries environment
  `production`, release `acorn@<batch.version>`, and `settings: TEAM_SETTINGS`.
- `TEAM_SETTINGS` in `shared/settings.ts` holds the fixed policy table. `SentryTarget` gained an
  optional `settings`, and the exporter uses it in place of the owner's page.
- **Share with the acorn team** on the settings page, off by default. It shows only while
  `GET /v1/p/sentry-telemetry/source` answers `shareable: true`. While it's on, the **What to send**
  description says the page's choices don't apply.
- Docs: a topic page, `docs/integrations/sentry/the-acorn-teams-dsn.md`, with a short section on
  the landing page, `docs/telemetry/plugins-and-sinks.md`, and `docs/README.md`. On the site:
  **Share with the acorn team** on Telemetry and privacy, a new Privacy policy page under Security,
  and short additions to the Sentry telemetry and Settings: Machines pages.

Decisions and deviations:

- "Breadcrumbs on errors only" needed a switch the page doesn't have, because `kinds.event` sends
  events both as breadcrumbs and as info logs. `SentrySettings` gained an optional `eventLogs`. The
  page never shows or stores it, and `parseSettings` ignores it, so only `TEAM_SETTINGS` turns it off.
- The share switch is its own preference row, `plugin:sentry-telemetry:share`, not a field on the
  settings object. It decides where records go, and keeping it apart means the fixed policy has no
  consent field in it. Only a stored `true` counts.
- An `ACORN_SENTRY_DSN` that doesn't parse still wins and sends nothing, as a broken connection
  does. A developer with a typo never falls through to the team's project.
- I gated the DSN to `v*` tags. The package job also runs on manual dispatch from any branch, and
  the goal says only a tag build carries it.
- The switch has no entry in the frame's `sections`, because most builds don't draw it. Its words
  are in the frame's search keywords.
- The docs and code don't name the Sentry data region, so nothing names one. The privacy policy says
  "the data region chosen for the acorn team's Sentry organization", and the switch's copy says
  "stored in the region that project uses". Once the
  organization exists, name its region in `apps/site/src/content/docs/docs/security/privacy-policy.md`.
- I didn't run the full `pnpm --filter @acorn/desktop run build`. I built the `sentry-telemetry`
  package directly into a scratch folder instead. With only `ACORN_SENTRY_DSN` set, the bundle holds
  no DSN and no leftover constant. With `ACORN_SENTRY_RELEASE_DSN` set, it holds that DSN once, and
  the `http` plugin built the same way holds none.
- The site pages that cite changed files but teach nothing untrue stay unmarked:
  `build-plugins/node/log-and-measure.mdx` and `built-in-plugins/sentry.mdx`.

What a person must set up:

1. In Sentry, create the organization and choose its data region, then the project.
2. Add the project's DSN as the repository secret `ACORN_SENTRY_DSN` on GitHub.
3. Turn on spike protection for the organization.
4. Set a rate limit on the project's client key. That's the real cost cap.
5. Name the region in the privacy policy page.
6. After a tag build, turn on both switches and confirm that a test error reaches the project tagged
   `production`. No live check ran here.

For later phases:

- Phase 5 can tell a team target apart by `target.settings === TEAM_SETTINGS`, or by environment
  `production`.
- Phase 6 uploads source maps for the same release string, `acorn@<node version>`.
- The standalone Node archive and the CLI carry no DSN. `build-node.yml` never sets the variable.
  That's the README's open question, still open.
- The same arch-test failure from the base commit remains: links to the deleted
  `workflows-gaps.md`. It hides the anchor check, which passes with it filtered out.

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
