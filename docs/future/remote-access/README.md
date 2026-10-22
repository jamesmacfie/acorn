# Remote access: reach your own Node from anywhere

Date: October 22, 2026. Status: phases 1 to 4 built October 22, 2026, except their hosted staging
steps, which wait on a domain and a product name. Phase 5 isn't started. Each phase file's completion
note records what landed. Where a file here disagrees with a shipped contract, the owning reference
document wins.

## What this is

A person signs in once. After that, every client they own reaches their Node from any network: the
desktop on another laptop, the terminal client, the `acorn` command line, the browser extension, and
the phone. There's no Tailscale, no gateway to start by hand, and no six-word identity check. A new
device is approved from a device they already paired.

Three hosted pieces make that work. The relay is open source, and anyone can run their own. The
account service and website are closed source and run by acorn, and the open code reaches them only
through a published API. An account service handles sign-in and remembers which Nodes belong to
whom. A relay joins a client to a Node that has no public address, and forwards encrypted
bytes it can't read. The account website serves the phone app, which opens its own encrypted
connection to the Node through the relay.

This programme comes before [cloud](../cloud/README.md). Cloud's hosted team Nodes and task workers
reuse the account service and the relay built here.

## Why it exists

Today a person reaches their Node from another machine in one of three ways. They advertise it on a
network they trust ([reaching a Node](../../node-distribution/reaching.md)), open an SSH tunnel, or
use Tailscale. The phone needs Tailscale, plus `tailscale serve` and `acorn mobile` left running in a
terminal ([use it on a phone](../../mobile/phone-setup.md)). A new device pairs either by a click in
the desktop on the Node's own machine or by typing a code read off that machine. Away from home,
neither works.

## Goals

- Sign in once per client. The Nodes you own appear in each client's list.
- Reach your Node from any network with no inbound port, no VPN, and no extra command.
- Pair a new device away from home, approved on a device you already paired.
- Use the phone from the account website, with a separate device record for each phone.
- Keep end-to-end encryption between every client and the Node.

## Non-goals

- Hosted Nodes, task workers, teams, roles, and billing. Those are [cloud](../cloud/README.md).
- Sharing a local Node with another person.
- Letting the account service admit a device on its own.
- A full browser workspace. [Remote access to a browser host](../remote.md) keeps that design.
- Push notifications, loaded plugins on the phone, and a native phone app. Those stay in
  [mobile work after the first release](../mobile/later.md).

## Rules no phase may break

| Rule | Why |
| --- | --- |
| A Node with no account behaves exactly as it does today, with no outbound connection and no account code running. | The open-source promise, and the same rule cloud keeps. |
| The relay forwards bytes it can't read. Native clients keep pinning the Node's certificate end to end. | A relay breach gives away who connected when, not what they did. |
| The account service stores accounts, Node names, fingerprints, and relay routes. It stores no task content: no code, prompts, transcripts, or plugin data. | Keeps the hosted side small and replaceable. |
| The account service vouches for a Node's identity, but a device token still decides who gets in. Only a person on a paired device can approve a new one. | A breach of the account service can't open someone's machine. |
| A local Node never accepts a cloud grant. Recording an owner account isn't a grant. | [Cloud](../cloud/refused.md#no-team-roles-on-an-owners-local-node) keeps local Nodes single-owner. |
| `/v1` routes, the `acorn-1` baseline, and the meaning of a device token don't change in place. New behavior is additive. | Older clients and Nodes keep working ([versioning](../../api-reference/versioning.md)). |
| Everything a self-hoster needs is open source in this repository. The open code reaches the closed hosted service only through the published account API, and every open-side test runs against a stand-in. | The Tailscale and ngrok model ([services](./services.md#where-the-code-lives)). |

## Read this programme

| File | What it covers |
| --- | --- |
| [accounts.md](./accounts.md) | Accounts, sign-in from each client, the sign-in plugin, the Node's owner account, and account assertions. |
| [relay.md](./relay.md) | How a client reaches a Node with no public address while still pinning its certificate, and how the phone's connection rides the same relay. |
| [pairing.md](./pairing.md) | Nodes listed by your account, pairing a device from anywhere, approving on a paired device, and the trust cost. |
| [phone.md](./phone.md) | The phone app served from the account website, its encrypted connection, a device for each phone, and retiring the gateway. |
| [services.md](./services.md) | The account service, the website, and the relay: where the code lives, environments, and credentials. |

## The phases

| Phase | What is deployed at the end | Who can use it | Depends on |
| --- | --- | --- | --- |
| [1. Relay](./01-relay.md) | A relay anyone can run with a static credential. Desktop, terminal client, CLI, and extension reach a Node through it. | Anyone who runs their own relay. | Nothing. |
| [2. Accounts](./02-accounts.md) | The account service, the account website, the sign-in plugin, and a hosted relay. Turn on **Remote access** and reach your Node from another network. | Allowlisted accounts. | 1. |
| [3. Pairing](./03-pairing.md) | Your account lists your Nodes with their fingerprints. Pair a new device away from home, approved on a paired desktop or terminal client. | Allowlisted accounts. | 2. |
| [4. Phone](./04-phone.md) | The phone app on the account website, through the relay, with a device for each phone, approvals from the phone, and several Nodes. The gateway and Tailscale steps are deleted. | Allowlisted accounts. | 3. |
| [5. Production](./05-production.md) | Abuse limits, metering, uptime, terms, real-device acceptance, and docs for running your own relay. | Everyone. | 4. |

[Cloud](../cloud/README.md) starts its team Node phase after phase 2 here, because team Nodes
use the account service and the relay from day one.

## Why this order

- **The relay first, with no accounts.** It's the riskiest piece: pinned TLS through a forwarded
  socket, the WebSocket upgrade on a socket that arrived by `emit`, and terminal latency. Self-hosted
  mode lets all of that be tested before any hosted service exists.
- **Accounts next.** Sign-in, tickets, and the **Remote access** switch turn the relay into something
  a person can use without editing configuration.
- **Pairing before the phone.** The phone pairs by the same relayed ask and approves asks itself, so
  the ask and its assertion must exist first.
- **The phone last among features.** It needs the relay, accounts, and pairing, and it's the only
  piece with a new protocol.
- **Production last.** Limits and metering need every relayed thing to exist.

## Rules for every phase

- Steps whose titles start with **Hosted service** happen in the closed hosted service, not in this
  repository. Open-side steps and checkpoints run against the stand-in account service
  ([services](./services.md#the-account-api-is-the-boundary)). When the hosted service has its own
  docs, its steps move there.
- Each phase starts by writing its design section: exact endpoints, wire schemas, and which owning
  documents change. Put it at the top of the phase file, or in the owning document if the contract is
  shipping.
- Run `pnpm lint` and the relevant tests for each slice, and `pnpm test` for the whole suite.
- For desktop changes, test in the real Tauri window with `pnpm dev:agent` and the UI driver. For
  terminal client changes, use the isolated PTY driver. See [local development](../../local-development.md).
- Test a packed Node as well as a checkout.
- A Node with no relay settings and nobody signed in must behave exactly as before. Each phase
  checks that it makes no outbound connection.
- When a phase ships a contract, update the owning document under `docs/` in the same change. Leave
  the phase file as the record of decisions and evidence.
- Record measured results, such as latency through the relay, in the phase file's evidence section
  with the date.
- Answer each phase's open questions, or defer them with a reason, before signing off its acceptance.

## How a checkpoint works

A checkpoint is a manual test that someone runs and records before the phase continues. It names the
setup, the steps, and what you should see. If a checkpoint fails, fix the cause before the next step.
A skipped checkpoint is written down as skipped, with the reason.

## Known gaps in the design

- How someone who never signs in runs the phone app against a self-hosted relay
  ([phase 4](./04-phone.md#open-questions)). The phone's channel library is decided: `@chainsafe/libp2p-noise`.
- Whether remote access is free, part of a personal plan, or paid
  ([phase 5](./05-production.md#open-questions)).
- The product name and domain ([phase 2](./02-accounts.md#open-questions)).
- How a client finds the relay instance its Node is on once a region has more than one
  ([relay](./relay.md#scale-and-placement)).

## Owning documents this programme extends

Before changing code, read [authentication](../../authentication.md),
[transport and auth](../../security/transport-and-auth.md),
[Node providers](../../plugins/node-providers.md#node-providers),
[reaching a Node](../../node-distribution/reaching.md), [the mobile web app](../../mobile.md), and
[the mobile gateway](../../relay/phone-channel.md).

## Verify before building

Recheck the shipped contracts before each phase. Don't turn a proposal in this folder into a claim
that a feature exists.
