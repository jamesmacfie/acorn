# Phase 5: production

Date: October 22, 2026. Status: proposed.

## Goal

Open remote access to everyone: limits that stop the relay being used as a free tunnel, metering,
uptime, terms, acceptance on real devices, and docs for people who run their own relay.

## What you can deploy at the end

Production account service, website, and relays. Anyone can sign in, turn on **Remote access**, and
use every client from any network.

## Starting point

Phases [1](./01-relay.md) to [4](./04-phone.md) on staging, used by allowlisted accounts.

## In scope

- Limits per account, per Node, and per stream on the relay, in the open relay code, with values set
  by whoever runs it.
- Byte metering per Node and account in the relay, shown on the hosted account page. No charge.
- Hosted service: rate limits on sign-in, tickets, and assertions.
- Hosted service: production deployment, backups, uptime checks, and a status page.
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

Deploy production with point-in-time recovery for the account database, an uptime check on the website, API, and
each relay, and a status page.

**Checkpoint 3: restore.** Restore the production database to a scratch copy from an hour ago, and
confirm a Node registered since is absent there and present in production.

### 3. Real devices

Run the [phone acceptance checklist](../../testing/mobile-on-a-phone.md) on real phones through the
production relay. Run the extension on a second machine on another network.

### 4. Your own relay

Write the self-hoster's guide: run `apps/relay`, set the static credential on the Node and clients,
and serve the phone app from your own host.

**Checkpoint 4: a self-hoster from scratch.** Someone who hasn't worked on the project follows the
guide and reaches their Node from their phone with no acorn account.

## Acceptance

- Production is up, backed up, and monitored.
- Limits and rate limits hold under the checkpoints.
- Real-device acceptance passes.
- The self-hoster's guide works from scratch.

## Docs to update when it ships

- `docs/relay.md`: limits and self-hosting.
- [Security](../../security.md): rate limits and what the account service stores.
- The public website, with sign-in and the terms.

## Open questions

1. Is remote access free, part of a personal plan, or paid?
2. What are the limits per account, Node, and stream?
3. Which regions get a relay at launch?

## Evidence

Record relay latency per region, with dates. Production incidents belong with the hosted service.

## Verify before building

Reread every earlier phase's evidence for limits and measurements that changed.
