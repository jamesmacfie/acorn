# Identity, grants, and roles

Status: proposed, 2026-09-29. Revised October 22, 2026, when accounts and sign-in moved to
[the account API](../../account-api.md). This file covers how a person proves to a hosted
Node who they are and what role they hold, and how that authority is taken away. Today acorn has no
accounts at all ([authentication](../../authentication.md)). Every paired device is the Node's
single owner. Hosted Nodes need a second authority path for people, and local Nodes must not
change.

## Accounts and sign-in

[The account API](../../account-api.md) owns accounts, sign-in from each client, and the
sign-in plugin on each local Node. Cloud adds two things to them:

- Better Auth's organization plugin maps to acorn teams, with custom roles `admin`, `member`, and
  `viewer`. Confirm its device authorization plugin works with the organization plugin before
  [phase 2](./02-team-node.md).
- Better Auth's two-factor plugin doesn't gate OAuth sign-in by default. A later acorn-wide second
  factor needs its own enforced step before the account service issues any grant. For more
  information, see [two-factor behavior](https://better-auth.com/docs/plugins/2fa).

## Grants

A _grant_ is how a person proves to a hosted Node that they hold a role there. It replaces a device
token for hosted Nodes only.

Recommended shape: a compact JSON Web Token signed with Ed25519 by the account service.

| Claim | Meaning |
| --- | --- |
| `iss` | The account service's issuer URL. |
| `aud` | The Node ID the grant is for. A grant for one Node is refused by every other. |
| `sub` | The account ID. |
| `team` | The team ID. |
| `role` | `admin`, `member`, or `viewer`. |
| `mv` | The membership version this grant was issued from. See [revocation](#revocation). |
| `exp` | Five minutes after issue. |
| `jti` | A unique ID, recorded in the Node's audit trail. |

The client asks the sign-in plugin for a grant. The plugin calls the account service with the
person's session. The account service checks membership and returns the grant and a relay ticket.
Custody holds both in memory, refreshes them a minute before expiry, and sends the grant as
`Authorization: Bearer acorn_gr_<jwt>`. A new prefix keeps it from ever reaching the device-token
path.

On the Node, grant verification sits beside device and internal authentication in
`packages/node-core/src/server/middleware/auth.ts`. The three paths stay mutually exclusive, as they
are today. The verified result is a new principal kind:

```ts
type Principal =
  | { kind: 'device' /* unchanged */ }
  | { kind: 'internal' /* unchanged */ }
  | { kind: 'member'; accountId: string; teamId: string; role: 'admin' | 'member' | 'viewer'; grantId: string }
```

A Node accepts grants only when it enrolled through enrollment v2, which delivered the issuer's
public keys and its own Node ID as the audience. A local Node never accepts a grant.

### What the enrollment v2 change is

Enrollment v1 posts a device token to the control plane, which gives the control plane full owner
authority ([Node enrollment](../../node-enrollment.md#the-inversion)). For hosted Nodes, that is
the wrong trade: the account service already controls who holds grants, so it does not also need a
standing owner credential. Enrollment v2 is a separate, versioned payload:

- The request carries `nodeId`, `fingerprint`, `baseline`, `protocolVersion`, the Node's role
  (`team` or `worker`), and no device token.
- The reply carries the grant issuer URL, its current public keys, a relay credential for this
  Node, and a service credential this Node uses to call the account service.
- `docs/schemas/enrollment-v2.json` is published beside v1, and v1 stays unchanged (new).

A team Node or worker that enrolled through v2 has no paired devices. Its owner principal exists for
internal service calls only.

## Roles and route classification

| Role | Can |
| --- | --- |
| `admin` | Everything a member can, plus manage members, plugin policy, cloud connections, secrets, regions, and billing. |
| `member` | Create and edit tasks, start and stop cloud work, spend the team budget, answer agent requests, publish projects. |
| `viewer` | Read code, diffs, transcripts, and artifacts. Cannot mutate, approve, answer, or run anything. |

The hard part is enforcement. Today every device principal is the owner, so no route declares
whether it reads or writes, and many plugin routes mutate on `GET`-shaped paths or through bridge
actions. Hiding a button is not enforcement. Hosted Nodes need a server-side classification:

1. Every core route declares `read`, `mutate`, or `admin`. Extend the mount coverage test in
   `packages/node-core/src/server/mountCoverage.test.ts` so an unclassified core route fails.
2. Every plugin route and action declares the same, in the manifest or at registration. An
   unclassified plugin action is denied to a viewer and allowed to a member. An admin-only action
   must say so.
3. WebSocket subscriptions and stream attaches are classified by what they expose. A terminal
   attach that can send input is `mutate`. A read-only terminal view is its own subscription.
4. Agent approvals, elicitation answers, and gate approvals are `mutate`.
5. Frame bridge verbs inherit the classification of the route they reach.

The classification is inert on a local Node. The check runs only for a `member` principal.

## Revocation

A hosted Node keeps an outbound connection to the account service over its service credential. The
account service pushes membership changes on it. On a change, the Node:

1. Records the team's new membership version.
2. Closes every WebSocket and stream held by an affected account.
3. Refuses any grant with an older `mv` for that account.

Grants expire after five minutes regardless, so a missed push is bounded.

During an account-service outage, a Node keeps honoring sessions whose last verified membership
state is at most five minutes old. New sign-in, new grants, and provisioning fail closed. A
revocation made during the outage cannot reach the Node until the connection returns. The UI and
the audit trail must say so plainly.

## Audit

A hosted Node writes an audit row for every accepted grant, keyed by `jti`, with the account ID and
role. Mutations record the account ID as the actor. A team admin can read the team Node's audit
trail. The account service keeps its own audit of sign-ins, membership changes, role changes, and
grant issuance, without any task content.

## Trust cost, stated plainly

The account service can mint a grant for any hosted Node, with any role. Trusting the account
service is therefore the whole game for hosted Nodes. What bounds it: grants are short-lived and
audited on the Node with the account ID, the account service has no read path to task content, and
it holds no standing Node credential. A team that cannot accept that trust needs a self-hosted
control plane, which the open account API contract allows.

## Verify before building

Check that Better Auth's device flow, organization roles, and session revocation behave as described
here with the current release. Check whether any core or plugin route relies on the principal being
a device for a reason other than ownership, such as pairing, plugin install, or backup. List those
before phase 2 and decide whether each is `admin`-only or refused outright on hosted Nodes.
