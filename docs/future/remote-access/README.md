# Remote access: reach your own Node from anywhere

Date: October 22, 2026. Status: proposed. Nothing in this programme is built or scheduled. Where a
file here disagrees with a shipped contract, the owning reference document wins until the code
changes that contract.

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
| [phases/README.md](./phases/README.md) | The five phases, what each deploys, and the rules for every phase. |

## The phases at a glance

| Phase | Deployed at the end |
| --- | --- |
| [1](./phases/01-relay.md) | A relay anyone can run, with a static credential. Native clients reach a Node through it. |
| [2](./phases/02-accounts.md) | The account service and hosted relay. Sign in, turn on **Remote access**, and reach your Node from another network. |
| [3](./phases/03-pairing.md) | Your account lists your Nodes. Pair a new device from anywhere, approved on a device you already paired. |
| [4](./phases/04-phone.md) | The phone app on the account website, through the relay, with a device for each phone. The gateway and Tailscale steps are gone. |
| [5](./phases/05-production.md) | Abuse limits, metering, uptime, terms, real-device acceptance, and docs for people who run their own relay. |

## Known gaps in the design

- Which encrypted channel protocol and library the phone uses. It must be a vetted
  implementation, never a hand-written handshake ([phase 4](./phases/04-phone.md#open-questions)).
- Whether remote access is free, part of a personal plan, or paid
  ([phase 5](./phases/05-production.md#open-questions)).
- The product name and domain ([phase 2](./phases/02-accounts.md#open-questions)).
- How a client finds the relay instance its Node is on once a region has more than one
  ([relay](./relay.md#scale-and-placement)).

## Owning documents this programme extends

Before changing code, read [authentication](../../authentication.md),
[transport and auth](../../security/transport-and-auth.md),
[Node providers](../../plugins/node-providers.md#node-providers),
[reaching a Node](../../node-distribution/reaching.md), [the mobile web app](../../mobile.md), and
[the mobile gateway](../../security/mobile-gateway.md).

## Verify before building

Recheck the shipped contracts before each phase. Don't turn a proposal in this folder into a claim
that a feature exists.
