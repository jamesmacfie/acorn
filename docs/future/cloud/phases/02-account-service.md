# Phase 2: the account service and admin web app

Status: proposed, 2026-09-29.

## Goal

Stand up the account service and its admin web app: sign in with GitHub, keep an acorn account ID
that is independent of GitHub, and create a team with a region. Run it locally first, then deploy it
to staging with a real domain, TLS, database, and CI.

No Nodes yet. This phase builds the identity foundation and the deployment pipeline that every later
control-plane change rides on.

## What you can deploy at the end

A staging site where an allowlisted person signs in with GitHub, sees their account, creates a team
with a region, and sees an empty Nodes page. A separate staging account API, versioned and
documented.

## Starting point

Nothing. acorn has no accounts ([authentication](../../../authentication.md)). The design is in
[identity](../identity.md) and [services](../services.md).

## In scope

- The private repository and its layout, if that decision holds.
- The account service: Hono, Better Auth, Drizzle, Postgres.
- GitHub sign-in, account linking rules, sessions, and session revocation.
- Teams with a region, the creator as admin, and team deletion.
- The admin web app shell: sign in, account, teams, empty Nodes page, account audit log.
- Local development with `docker compose`.
- Staging deployment: domain, TLS, managed Postgres, secrets, CI, error reporting.
- An allowlist for sign-in.

## Out of scope

Invitations, members other than the creator, grants, provisioning, billing, and anything that
touches a Node.

## Steps and checkpoints

### 1. Scaffold the service

Create the repository with the account service, the admin web app, and a `docker compose` file for
Postgres. Register a development GitHub OAuth app with a localhost callback. Configure Better Auth
with the Drizzle adapter, GitHub as the only provider, and `disableImplicitLinking: true`.

**Checkpoint 1: sign in locally.** Start the stack, open the web app, and sign in with GitHub. The
`users` table should hold a row with an acorn account ID and a separate linked GitHub account row.
Sign out and sign back in: the same account ID.

**Checkpoint 2: no implicit merge.** Sign in with a second GitHub account that has the same verified
email as the first. You should get a second, separate acorn account.

**Checkpoint 3: sessions.** Sign in from two browsers. The account page lists both sessions. Revoke
one. The revoked browser is signed out on its next request.

### 2. Teams

Add teams through Better Auth's organization plugin, with custom roles `admin`, `member`, and
`viewer`. Only `admin` is used in this phase. Creating a team asks for a name and a region: US, EU,
or APAC. The region is stored and cannot be changed from the UI.

**Checkpoint 4: create and delete a team.** Create a team. It appears with you as admin and its
region. The Nodes page is empty. Delete the team. It disappears, and the account audit log records
both actions.

### 3. The account API

Expose the account service's API under a versioned prefix, such as `/v1`, separate from the web
app's session routes. Write its schemas as Zod types and publish them as JSON schema, the way
[Node enrollment](../../../node-enrollment.md#the-payload) publishes enrollment v1. Phase 3 adds the
routes a Node and the cloud plugin call.

### 4. Deploy staging

Register the domain, create the staging database, create a staging GitHub OAuth app, store the
service secrets in the host's secret store, and deploy the service behind public TLS. Add CI that
runs tests on every change and deploys staging on merge. Add error reporting that records account
IDs and request IDs, and nothing from request bodies. Add an uptime check.

**Checkpoint 5: staging sign-in from outside.** From a machine that has never touched the project,
open the staging URL and sign in with an allowlisted GitHub account. A GitHub account that is not on
the allowlist is refused with a plain message.

**Checkpoint 6: a deploy does not sign people out.** Sign in, merge a trivial change, and wait for
the deploy. Your session should survive.

**Checkpoint 7: database restore.** Restore the staging database to a point before a test team was
created, into a scratch database, and confirm the team is absent there and present in the live one.

## Acceptance

- Sign-in, linking, session revocation, and teams behave as the checkpoints describe, on staging.
- The account API has a published schema and tests that pin it.
- CI deploys staging on merge. A failed test blocks the deploy.
- No log line, error report, or table holds anything beyond account metadata.

## Docs to update when it ships

- The private repository's own README for running the stack.
- [services](../services.md) with the chosen repository split, hosting, and domain.

## Open questions

1. Private repository or not? A private repository keeps the business logic closed, but the admin
   web app then cannot import `@acorn/client-core` from a workspace path. Publish the kit as a
   package, copy tokens, or build the web app without the kit.
2. Solid single-page app, or server-rendered pages? A single-page app matches the desktop stack. A
   server-rendered app is smaller and has fewer CSRF and token-storage questions.
3. Where does the control plane run, and on which Postgres host? It holds personal data such as
   emails and names, so the region matters for EU customers.
4. Do EU teams need their account metadata stored in the EU, not only their Nodes and archives?
   This decides whether the account service is regional too.
5. What is the domain and product name?
6. How does the allowlist work: a table edited by hand, a waitlist form, or GitHub organization
   membership?
7. What terms of service and privacy policy must exist before any outside person signs in?
8. How is the account API versioned and documented so a third party could write a compatible
   control plane?
9. Which Better Auth release, and do its device authorization and organization plugins work
   together? Phase 3 depends on it.
10. What rate limits apply to sign-in and API routes?

## Evidence

Record deployment details and any Better Auth findings here, with dates.

## Verify before building

Recheck Better Auth's documentation for linking, organizations, device authorization, and two-factor
behavior. Check the Hono and Drizzle versions this repository uses, so the private repository can
match them.
