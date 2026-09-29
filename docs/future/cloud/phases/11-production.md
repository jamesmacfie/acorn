# Phase 11: production

Status: proposed, 2026-09-29.

## Goal

Open the service to everyone, in three regions, with backups that restore, limits that hold,
operations people can run, and the speed target met or honestly narrowed.

## What you can deploy at the end

General availability: production account service, relays and team Nodes in one US, one EU, and one
APAC region, public sign-up, a status page, and published documentation.

## Starting point

The paid beta from [phase 10](./10-billing.md), running on staging-grade infrastructure.

## In scope

- Production environments, separate from staging.
- Three regions, each with a relay, a bucket, team Node capacity, and worker capacity.
- Backup and restore drills for team Nodes and the account database.
- Key rotation: grant issuer keys, archive keys, and service secrets.
- Image rollout and team Node upgrades.
- Quotas from measured capacity.
- The speed target, measured per region.
- Runbooks, on-call, incident process, and a status page.
- An external security review.
- Legal documents.
- Moving shipped behavior from this folder to owning documents.

## Steps and checkpoints

### 1. Production infrastructure

Create production accounts for the provider, database, buckets, registry, email, and billing,
separate from staging. Check off the list in [services](../services.md#infrastructure-that-must-exist-before-production).

### 2. Regions

**Checkpoint 1: data stays put.** For a test team in each region, list where every object lives: team
Node volume, worker, snapshot, artifact, archive, and relay. Each must be in the team's region.

### 3. Backups and restore drills

**Checkpoint 2: restore a team Node.** Restore a test team's Node from last night's volume snapshot
into a new machine. Clients reconnect after the fingerprint change is handled through the documented
repair. Shared projects, cloud task history, and archive manifests are intact.

**Checkpoint 3: restore the account database.** Restore the account database to a point in time in a
scratch environment. Memberships and the ledger match.

### 4. Rotation and upgrades

**Checkpoint 4: rotate the grant issuer key.** Rotate the signing key. Connected clients keep working
through refresh. Grants signed by the old key stop working after the overlap window.

**Checkpoint 5: upgrade team Nodes.** Roll a new image to team Nodes in batches. Connected clients
reconnect. A client one version older still works.

### 5. Limits and failure drills

Set concurrent-worker, runtime, and storage quotas per team from measured capacity, for tens of teams
and hundreds of simultaneous workers.

**Checkpoint 6: failure drills.** Run each drill and record the result: region capacity exhausted,
provider API errors, archive backlog, relay instance loss, account service outage, and a bucket
outage. Admission should fail visibly, nothing should be lost, and the status page should say what is
wrong.

### 6. The speed target

Measure the warm path per region: **Run in cloud** to an adopted worker with its roster visible. If a
region misses 15 seconds at p95, fund warm capacity or publish that region's target. Publish cold-path
latency too.

### 7. Operations

Write runbooks for every alert. Set up on-call. Give every request a support ID that appears in the
UI and the logs. Keep logs free of code and prompts.

### 8. Security and legal

Commission an external security review of the account service, relay, and worker. Publish terms of
service, a privacy policy, a data processing agreement, and a list of subprocessors.

### 9. Documentation

Move every shipped behavior from this folder into owning documents under `docs/`. Leave this folder
as the record of decisions, evidence, and what remains.

## Acceptance

- Every checkpoint above passes in production-grade environments.
- The external review's findings are fixed or accepted in writing.
- The speed target is met in every region, or the narrower target is published.

## Open questions

1. Which provider regions map to US, EU, and APAC?
2. What service level does acorn commit to, if any?
3. Who is on call, and what are the response times?
4. How does acorn staff get emergency access to a team Node, and how is the team told?
5. When is a compliance audit such as SOC 2 needed, and for which customers?
6. How quickly is data deleted after a team is deleted, and how is that proven?
7. Is public sign-up open, or is there still a waitlist?

## Evidence

Record drill results, per-region speed measurements, and review findings here, with dates.

## Verify before building

Recheck every provider fact, price, and region list. Reread each earlier phase's open questions and
confirm each one was answered or deferred in writing.
