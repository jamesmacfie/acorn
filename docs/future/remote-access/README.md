# Remote access: reach your own Node from anywhere

Date: October 22, 2026. Revised October 26, 2026. Status: phases 1 to 4 were built on October 22,
2026, and the hosted service went to production for allowlisted accounts the same day, without a
staging step. This folder keeps only the work that's left: [phase 5](./05-production.md), which opens
remote access to everyone. The phase records for the built work are in git history before October 26,
2026.

## What this is

A person signs in once. After that, every client they own reaches their Node from any network: the
desktop on another laptop, the terminal client, the `acorn` command line, the browser extension, and
the phone. A new device is approved from a device they already paired.

The shipped design lives in its owning documents:

| Part | Owning document |
| --- | --- |
| The relay, its self-hosted mode, and its limits | [The relay](../../relay.md), [relays and accounts](../../relay/accounts.md) |
| Accounts, sign-in, tickets, and assertions | [The account API](../../account-api.md) |
| Pairing by approval, from anywhere | [Authentication](../../authentication.md#pairing), [pairing by approval](../../api-reference/transport.md#pairing-by-approval) |
| The phone app and its encrypted channel | [The mobile web app](../../mobile.md), [the phone channel](../../relay/phone-channel.md) |
| What the account service could do if breached | [Control plane security](../../security/control-plane.md#the-account-service) |

[Cloud](../cloud/README.md) reuses the account service and the relay for its team Nodes and task
workers.

## Rules no phase may break

| Rule | Why |
| --- | --- |
| A Node with no account behaves exactly as it does today, with no outbound connection and no account code running. | The open-source promise, and the same rule cloud keeps. |
| The relay forwards bytes it can't read. Native clients keep pinning the Node's certificate end to end. | A relay breach gives away who connected when, not what they did. |
| The account service stores accounts, Node names, fingerprints, and relay routes. It stores no task content: no code, prompts, transcripts, or plugin data. | Keeps the hosted side small and replaceable. |
| The account service vouches for a Node's identity, but a device token still decides who gets in. Only a person on a paired device can approve a new one. | A breach of the account service can't open someone's machine. |
| A local Node never accepts a cloud grant. Recording an owner account isn't a grant. | [Cloud](../cloud/refused.md#no-team-roles-on-an-owners-local-node) keeps local Nodes single-owner. |
| `/v1` routes, the `acorn-1` baseline, and the meaning of a device token don't change in place. New behavior is additive. | Older clients and Nodes keep working ([versioning](../../api-reference/versioning.md)). |
| Everything a self-hoster needs is open source in this repository. The open code reaches the closed hosted service only through the published account API, and every open-side test runs against a stand-in. | The Tailscale and ngrok model ([where the code lives](#where-the-code-lives)). |

## Where the code lives

Decided October 22, 2026: the Tailscale and ngrok model. The code that runs on a person's machines
is open source, and the hosted service acorn runs is closed source.

- **Open source, in this repository:** the relay in `apps/relay` with its self-hosted mode, the Node's
  tunnel client and channel endpoint in `packages/node-core`, the relay socket factory in
  `@acorn/custody`, the sign-in plugin in `plugins/account`, the phone app, the account API's types
  and published schemas, a stand-in account service for tests, and every protocol type in
  `@acorn/protocol`.
- **Closed source, run by acorn:** the hosted service. That's the account service, the account
  website's own pages, sign-up and plans, and the infrastructure that runs them. It isn't in this
  repository.

A self-hoster needs nothing closed. The relay's self-hosted mode reaches their own Node with no
account.

### How the docs refer to the hosted service

Docs in this repository describe the open code and the account API. They refer to "the hosted
service" or "the account service" by what it does and which routes it answers, never by its
repository, file paths, or internals. Someone who clones this repository must be able to follow every
link and run every check.

The hosted service has its own docs, kept with its code. Its infrastructure, deployment, and
operation are described there, so phase 5's hosted steps are planned there too.

## Rules for the work left

- Open-side steps and checkpoints run against the stand-in account service
  ([test an implementation](../../account-api.md#test-an-implementation)).
- Run `pnpm lint` and the relevant tests for each slice, and `pnpm test` for the whole suite.
- Test a packed Node as well as a checkout.
- A Node with no relay settings and nobody signed in must behave exactly as before, with no outbound
  connection.
- When a step ships a contract, update the owning document under `docs/` in the same change.
- Record measured results, such as latency through the relay, in the phase file's evidence section
  with the date.
- A checkpoint is a manual test someone runs and records before the work continues. A skipped
  checkpoint is written down as skipped, with the reason.
