# Cloud delivery plan

Status: proposed, 2026-09-29. This plan orders work; it does not claim the cloud service is
implemented or scheduled. Read the [architecture](./architecture.md) for ownership and data flow
before taking a phase. Each phase ends with a behavior someone can demonstrate.

## Contracts that must change

Keep the current `/v1` Node routes and `acorn-1` baseline compatible. Add optional protocol types
and routes, or bump a separate public protocol when an additive change cannot express the behavior.
Do not change enrollment-v1 or an existing device token's authority in place.

| Contract | Required addition | Owner |
| --- | --- | --- |
| Project and task identity | Stable team project and logical task IDs, local-project mapping, execution location, and worker-attempt provenance. | Durable team Node, projected through `@acorn/protocol`. |
| Task lifecycle | Idempotent reserve, provision, setup, route, stop, archive, restore, and reconcile operations with observable states. | Team Node orchestrator; worker Node remains the live task authority. |
| History transfer | Ordered, resumable core and agent event and artifact transfer, with a checkpoint before worker destruction. | Core and Agents plugin, through explicit contracts. |
| Plugin policy | Team baseline, project override, approved package hash and grants, and a frozen per-attempt lock. | Team Node policy and Node plugin loader. |
| Plugin configuration | Cloud-owned connections and settings, readiness checks, and an explicit provisioning path for supported plugins. | Team Node and each plugin's declared setup contract. |
| Cloud authorization | Per-user, per-team, audience-bound Node grant and route-level role enforcement; revocation closes streams. | Account service issues grants; each hosted Node enforces them. |
| Reachability | An outbound relay endpoint that preserves broker certificate pinning and Node authentication. | Relay and client custody adapters. |
| Archive | Versioned encrypted whole-root format, manifest and hash verification, regional placement, and credential rotation on restore. | Team Node archive manager and task Node capture. |
| Usage | Admission reservation, provider usage reconciliation, hard team budget, and visible estimates. | Control plane billing records and team Node admission. |

The first implementation design should state exact endpoints, wire schemas, and idempotency keys
before code changes. Put new Node wire shapes in `@acorn/protocol`; keep the hosted account API
separate from the Node API. An agent or plugin must not get an administrative cloud grant through
an existing task-scoped token.

## Phase 0: prove the hard boundaries

Complete these experiments before committing to a provider or archive format:

1. Boot the packed standalone Node and the selected pinned plugins in a region-pinned Fly Machine.
   Measure p50, p95, and worst-case time from provision request to authenticated Node and usable
   plugin roster, with a warm image and a cold approved plugin. Compare at least one alternative if
   Fly Machines cannot meet the stated region and 15-second warm-path target. Price the measured
   CPU, memory, storage, transfer, and prewarmed capacity using the provider's current terms.
2. Capture a task Node while Agents and a loaded plugin own SQLite files and blobs. Restore it on
   another machine, verify every record and file, and prove that old device tokens, certificates,
   and internal signing keys cannot authenticate to the restored Node. Determine which live
   resources need a drain before a consistent capture.
3. Send Node HTTP, WebSocket, and a task stream through an opaque outbound relay. Verify the
   desktop and TUI still validate the pinned Node identity, revoked credentials close sockets,
   and the relay cannot read application frames. Test reconnect after relay and Node restarts.
4. Prototype Better Auth in a separate account service using Hono and Drizzle. Prove explicit
   account linking, custom team roles, session revocation, and a short-lived Node grant whose
   recipient enforces the role without accepting a browser cookie as a device token. Record the
   extra OAuth step needed before offering Acorn-wide 2FA. Inventory core and plugin routes whose
   read or mutation authority is not declared; default an unclassified action to deny for viewers.
5. Trace a local project through upload, worker run, history transfer, and restoration. Confirm
   which existing task and plugin APIs can address a worker and which need an additive cloud
   contract. Record the minimum client surfaces that work in desktop and TUI.
6. Run an adversarial agent and plugin inside a worker. Check access to the worker Node's data
   root, account or enrollment credentials, model keys, and team Node grants; check outbound
   traffic from agent, plugin, and Node processes. Decide whether child-process isolation is
   required in addition to the provider VM, and define a task-scoped path for CLI model keys that
   preserves the sandbox programme's child-environment policy.

An experiment fails the gate if it needs task content in the control plane, silently trusts a
plugin package on a client, stores an unscoped long-lived owner token in the web app, loses plugin
data, or destroys compute before archive verification. If the 15-second target needs a warm pool,
record its monthly standing cost and capacity by region before choosing it.

## Phase 1: one person's cloud task

Build a private end-to-end slice on the target architecture, without team invitations or payment:

1. Create one durable team Node for a test account and one shared project ID. Explicitly map a
   local project to it. Accept a Git revision or a reviewed snapshot of tracked and selected
   untracked files. Show the recipient and upload size before transfer.
2. Implement a provider adapter and a single region-pinned worker type from a prebuilt Node image.
   Reserve the task and worker-attempt IDs before provisioning. Extend enrollment without changing
   enrollment-v1. Provision a full Node with the frozen built-in and pinned-package plugin roster,
   then adopt it through pinned custody. Check cloud plugin settings and connections before
   provisioning. A retry after a timeout must find the first worker.
3. Run one managed agent, open its files and terminal, inspect its diff, and publish a branch,
   pull request, or patch. Give the logical task one project row in the client while its live calls
   address the worker. Keep agent work running when the client disconnects.
4. Transfer core and agent history to the durable Node with replay and deduplication. After five
   idle minutes, drain the worker, verify an encrypted whole-root archive, and destroy compute.
   Read the transcript immediately from the team Node and restore plugin details on demand.

Acceptance: restart the client, team Node, relay, and task Node at different points without a
duplicate worker or lost acknowledged history. Repeat with a failed plugin, an interrupted upload,
and a failed archive write. No test may report a destroyed worker as safely archived until its
manifest and objects verify.

## Phase 2: both working clients and private reachability

Make the same logical project and cloud task visible in desktop and TUI. Both clients can select
cloud execution, watch setup and spend, use the supported agent workspace, answer a request,
inspect the result, and request restoration. Respect Node-scoped caches and plugin trust on each
device. Add owner-only remote access to an existing private local Node through the outbound relay;
local Nodes keep their single-owner device tokens and data roots.

Acceptance: run the same task from desktop and TUI, disconnect one client during an agent turn,
and reconnect both without replay gaps or duplicate approvals. A local Node with no account still
works without the relay. A remote Node whose fingerprint changes is refused until explicitly
repaired. The first web app remains administrative and cannot fetch task content.

## Phase 3: teams, web administration, and charging

Add the account service and administration web app with GitHub sign in, explicit identity linking,
team invitations, admin/member/viewer roles, Node inventory, regional choice, team plugin baseline
and project overrides, secret administration, usage, billing, and budget settings. Keep account IDs
independent of GitHub IDs so another OAuth provider and email/password can be added later.

Hosted Nodes enforce the member role at every route, stream, plugin bridge, and approval action.
Admin-approved pinned packages and grants become the only packages a shared cloud project can
select. Viewers can read code and history but cannot start compute or resolve an agent request.
The account service pushes known revocations immediately; hosted Nodes stop accepting stale
membership state after five minutes of account-service outage. Test that a user removed from a
team cannot retain a live WebSocket or obtain a worker grant from an earlier Node endpoint.

Charge a monthly team base plan plus measured worker, archive, artifact, snapshot, and relay use.
Model calls use team-supplied provider keys. Reserve spend and a concurrency slot before creating
a worker, reconcile provider readings, and enforce a hard team budget. A cap reached during a run
starts the graceful stop and archive path. Show an estimate and the material uncertainty before
the user starts a task.

Acceptance: two members see the same shared project, a viewer cannot mutate it, an admin can
revoke access, and the web app can manage roles and billing without a task-content endpoint.
Simulate an account-service outage and verify the bounded continuity rule. Reconcile a test
provider invoice against the usage ledger and inspect the result of an enforced budget cap.

## Phase 4: production gate

Offer one supported region in each of the US, EU, and APAC only after provider placement and
regional storage are verified. Test backups and restoration of the durable team Node, deletion of
task archives, secret rotation, region capacity exhaustion, provider API errors, archive backlog,
and relay failover. Set explicit concurrent-worker and storage quotas from measured capacity for
the initial target of tens of teams and hundreds of simultaneous workers. Keep a degraded-state
page and request IDs for support without logging code or prompts.

Measure the common warm path against the 15-second interactive-Node target. Show separate setup
progress for checkout, dependency installation, and plugin initialization, and publish cold-path
latency. If a supported region misses the target, either fund enough warm capacity to meet it or
state the narrower supported target before launch. Do not silently relax the target in the client.

Use `pnpm lint` and the relevant tests for each code slice, with `pnpm test` for the complete suite.
For desktop changes, test the real Tauri window with `pnpm dev:agent` and the UI driver; for TUI
changes, use the isolated PTY driver and its navigation flow. The commands and stop procedures are
in [local development](../../local-development.md). Test a packaged standalone Node as well as
development services.

## Verify before building

Confirm every path and type named here against the code before implementing a phase. Recheck vendor
APIs, placement support, limits, and prices. Revisit the client and Node protocol version rules in
[API reference](../../api-reference.md#versioning) before publishing any new wire contract. If a
phase changes task data ownership or plugin custody, update the owning reference document when it
ships rather than leaving this proposal as the only explanation.
