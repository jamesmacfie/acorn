# Build browser and mobile clients

Date: October 8, 2026. Status: client foundations implemented; browser and mobile clients remain proposed.

Use this design to plan a browser workspace and a mobile progressive web app.
[Cloud](./cloud/README.md) owns account services, hosted tasks, and the relay.
Its administration web app is separate from the workspace proposed here.

## Starting point

The desktop and terminal clients share Node APIs, node-scoped caches, host components, and the
platform adapter in `packages/client-core/src/infra/platform/`. A standalone Node runs the same
service graph as the desktop-supervised Node. These foundations are implemented.

Frame form factors and the bridge's scheme-independent messages are implemented too.
Browser authentication, asset serving, plugin custody, and browser-valid transport require their
own host adapters and Node contracts. The terminal client's local token storage is not a browser
implementation.

## Build a single-Node browser host

Start with [runtime architecture](../architecture-overview.md), [transport and auth](../security/transport-and-auth.md),
[platform access](../frontend.md), and [plugin custody](../caching.md).
Trace requests through client transport, authorization, Node routes, query caches, and plugin mounts.

Complete these design decisions before implementing authentication:

1. Choose browser session storage and renewal. Model each revocable browser session as an identifiable
   client of the Node; preserve task and owner authorization.
2. Define HTTP and WebSocket authentication. Browsers cannot set the desktop's bearer header on a
   WebSocket upgrade. Avoid long-lived credentials in URLs or logs.
3. Define cross-site request protection, allowed origins, request limits, failed-login handling,
   logout, and revocation. Test cookies and bearer alternatives against the chosen deployment shape.
4. Decide where the shell bundle is served. Document who controls its bytes and whether a connected
   Node can replace them.
5. Select browser-valid TLS and reachability. Browser transport cannot implement the native broker's
   certificate pinning. Record the changed trust model and certificate validation behavior.

Acceptance: a browser can sign in, open a task, supervise an agent, answer a permission request,
reconnect, and sign out. A revoked session loses HTTP and WebSocket access. Cross-origin and
unauthorized task requests fail. Reload preserves only the state and credentials the design permits.

## Implement browser plugin custody

Implement the complete `PluginCustody` group, including install and removal of device bundles.
Use a browser store for bundles and trust decisions, and cryptographic hashing for exact-byte identity.
Fetched sources need origin permission or a scoped proxy. Browser hosts cannot install local folders.

Keep loaded UI in an opaque-origin sandbox and preserve contribution authority, manifest limits,
update consent, and fallback behavior. Decide how trust records survive storage eviction and how
shared browsers keep users separate. A non-extractable encryption key can protect copied storage;
code running in the shell can still use it. Do not describe that as protection from shell script injection.

Acceptance: install, render, update, revoke, remove, and recover a device bundle after reload.
Verify tampered bytes, unavailable sources, denied permissions, and browser storage loss.

## Add multiple Nodes

Use browser connections to independent Nodes as the initial design. Keep one connection and one
query-cache scope per Node. Implement its transport and token custody through the host adapter.
Start with one Node before adding remembered endpoints, switching, and concurrent reads.

A hub that proxies between Nodes needs peer pairing, proxy authority, and failure contracts.
Revisit it only if direct browser connections fail a demonstrated deployment requirement.

Acceptance: two Nodes with overlapping task identifiers keep data, credentials, trust, and pending
responses separate. Switching Nodes during a read or action cannot apply the result to the other Node.

## Define the mobile subset

Build a progressive web app for attention, agent status, permission and question replies, task
navigation, and explicit task starts. Confirm this subset before extending it to a pane workspace.
Reuse narrow host layouts and form-factor declarations; do not expose a desktop-only frame on a phone.

Define focus, touch targets, navigation, and recovery for narrow screens. Use explicit actions for
controls that rely on hover in the desktop. Document unsupported file and terminal operations.

Background delivery needs a push subscription and a Node-owned event path because a suspended
phone cannot retain a foreground socket. Define subscription authority, revocation, duplicate
handling, and notification content. Keep secrets and task contents out of routing metadata.

Acceptance: test the supported mobile browsers on real devices, foreground reconnect, background
notification, expired sessions, approval completion, and a Node that becomes unavailable mid-action.
Record install behavior and host limitations rather than assuming desktop component support proves them.

## Coordinate the relay

[Cloud relay](./cloud/relay.md) and [its phase plan](./cloud/phases/04-relay.md) own opaque routing,
account scope, and implementation order. Desktop and TUI relay access can precede a browser workspace.
Remove the earlier requirement to wait for the browser client.

A browser integration must preserve end-to-end client/Node authority and document its browser TLS
and session model. Push delivery is a separate contract even if it uses the same hosted service.

## Verify and hand off

Split authentication, the browser host, custody, multi-Node access, and mobile delivery into reviewable
implementation tasks after the deployment decisions are recorded. Each task must name contracts,
migrations, fixtures, and acceptance environments.
Update the owning architecture, auth, custody, and host reference docs as behavior ships.
Run owner and consumer suites, lint, architecture checks, and browser integration acceptance.

## Verify before building

- Inspect platform groups, custody interfaces, Node authentication, origin checks, and WebSocket setup.
- Recheck browser constraints for the supported browsers and chosen deployment.
- Read cloud relay and identity decisions before adding another account or tunnel contract.
- Verify the sandbox and contribution selection under the actual browser origin and storage model.
