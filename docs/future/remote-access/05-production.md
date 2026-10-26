# Phase 5: production

Date: October 22, 2026. Revised October 26, 2026. Status: not started.

## Goal

Open remote access to everyone: limits that stop the relay being used as a free tunnel, metering,
uptime, terms, acceptance on real devices, and docs for people who run their own relay.

## What you can deploy at the end

Production account service, website, and relays. Anyone can sign in, turn on **Remote access**, and
use every client from any network.

## Starting point

Phases 1 to 4 are in production for allowlisted accounts. There was no staging step.

- The relay limits only how many streams one route holds: 256, and 32 for previews. Both are
  constants in `apps/relay/src/relay.ts`. It counts no bytes.
- Nothing limits sign-ins, Node registrations, tickets, or assertions. The account service issues a
  ticket for any Node an account owns, with no cap. The phone app's files on the account website and
  the 30-day phone limit have no abuse limits.
- The phone app has run only in desktop WebKit and Chromium at phone size, against the stand-in
  account service. The [phone acceptance checklist](../../testing/mobile-on-a-phone.md) hasn't run on
  a real phone.
- [Run your own relay](../../relay.md#run-your-own-relay) covers the relay's settings and its
  container. It doesn't cover the phone, because the phone can't pair without an account
  ([open question 4](#open-questions)).

## In scope

- Limits per account, per Node, and per stream on the relay, in the open relay code, with values set
  by whoever runs it.
- Byte metering per Node and account in the relay, shown on the hosted account page. No charge.
- Hosted service: rate limits on sign-in, registrations, tickets, and assertions.
- Hosted service: point-in-time recovery, uptime checks, and a status page.
- Hosted service: terms of service and a privacy policy.
- Real-device acceptance for the phone and the extension.
- Docs for running your own relay.

## Out of scope

Billing, teams, and hosted Nodes, which are [cloud](../cloud/README.md).

## Steps and checkpoints

### 1. Limits and metering

**Checkpoint 1: limits bite.** Push a bulk transfer through one stream past its limit. The relay
slows or closes it with a reason the client shows. Open more streams than an account may hold. The
extra ones are refused.

**Checkpoint 2: metering.** After an hour of use, the account page shows bytes in each direction per
Node.

### 2. Hosted service: production

Add point-in-time recovery for the account database, an uptime check on the website, API, and each
relay, and a status page.

**Checkpoint 3: restore.** Restore the production database to a scratch copy from an hour ago, and
confirm a Node registered since is absent there and present in production.

### 3. Real devices

Run the [phone acceptance checklist](../../testing/mobile-on-a-phone.md) on a real iPhone and a real
Android phone through the production relay, signed in with real GitHub. Run the extension on a second
machine on another network.

### 4. Your own relay

Write the self-hoster's guide: run `apps/relay`, set the static credential on the Node and clients,
and serve the phone app from your own host. This step needs an answer to open question 4 first.

**Checkpoint 4: a self-hoster from scratch.** Someone who hasn't worked on the project follows the
guide and reaches their Node from their phone with no acorn account.

### 5. Measure each region

Measure what the relay adds to a keystroke's round trip in each launch region. The working target is
less than 1 ms beyond the network path to the relay. On one computer it adds about 0.15 ms a frame
and costs 18% of download throughput. Move the relay from TypeScript to Go only if a regional
measurement says so.

## Smaller gaps left by phases 1 to 4

- `GET /v1/node` doesn't report relay state, so a relay failure reads as an ordinary `unreachable`
  with no relay reason.
- The account service can't say whether a Node is connected to the relay. Showing that in the list
  means the relay telling the service, which the contract says it never does. That needs its own
  design.
- A Node that turned on remote access before phase 4 has no channel key. The phone tells its owner
  to turn **Remote access** off and on.
- The phone's device list loads once and doesn't refresh while the page is open.
- `acorn node devices` doesn't show a device's `kind`. Its output schema is published, so the field
  would be an addition.
- With more than one relay instance in a region, a client that lands on the wrong one needs a
  redirect or a shared routing table. Start with one instance and a warm standby, then measure.
- Nobody has run a packed Node end to end with remote access. `pnpm pack:node` was red on main for
  unrelated reasons until October 26, 2026.

## Acceptance

- Production is up, backed up, and monitored.
- Limits and rate limits hold under the checkpoints.
- Real-device acceptance passes.
- The self-hoster's guide works from scratch.

## Docs to update when it ships

- `docs/relay.md`: limits, metering, and self-hosting.
- [Security](../../security.md): rate limits.
- The public website, with sign-in and the terms.

## Open questions

1. Is remote access free, part of a personal plan, or paid?
2. What are the limits per account, Node, and stream?
3. Which regions get a relay at launch?
4. How does someone who never signs in run the phone app against a self-hosted relay? A phone with no
   account has no list to take the Node's channel key from, so it can't pair.
5. What is the product name? The production domain is a working name.
6. Hosted service: do EU accounts need their metadata stored in the EU?

## Evidence

Record relay latency per region, with dates. Production incidents belong with the hosted service.
