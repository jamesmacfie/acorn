# Remote access phases

Date: October 22, 2026. Status: proposed. Five phases, each ending in something deployed that a person
can use. Read [the programme](../README.md) first.

## The sequence

| Phase | What is deployed at the end | Who can use it | Depends on |
| --- | --- | --- | --- |
| [1. Relay](./01-relay.md) | A relay anyone can run with a static credential. Desktop, terminal client, CLI, and extension reach a Node through it. | Anyone who runs their own relay. | Nothing. |
| [2. Accounts](./02-accounts.md) | The account service, the account website, the sign-in plugin, and a hosted relay. Turn on **Remote access** and reach your Node from another network. | Allowlisted accounts. | 1. |
| [3. Pairing](./03-pairing.md) | Your account lists your Nodes with their fingerprints. Pair a new device away from home, approved on a paired desktop or terminal client. | Allowlisted accounts. | 2. |
| [4. Phone](./04-phone.md) | The phone app on the account website, through the relay, with a device for each phone, approvals from the phone, and several Nodes. The gateway and Tailscale steps are deleted. | Allowlisted accounts. | 3. |
| [5. Production](./05-production.md) | Abuse limits, metering, uptime, terms, real-device acceptance, and docs for running your own relay. | Everyone. | 4. |

[Cloud](../../cloud/phases/README.md) starts its team Node phase after phase 2 here, because team Nodes
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
  ([services](../services.md#the-account-api-is-the-boundary)). When the hosted service has its own
  docs, its steps move there.
- Each phase starts by writing its design section: exact endpoints, wire schemas, and which owning
  documents change. Put it at the top of the phase file, or in the owning document if the contract is
  shipping.
- Run `pnpm lint` and the relevant tests for each slice, and `pnpm test` for the whole suite.
- For desktop changes, test in the real Tauri window with `pnpm dev:agent` and the UI driver. For
  terminal client changes, use the isolated PTY driver. See [local development](../../../local-development.md).
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

## Verify before building

Before starting a phase, reread the phases before it for decisions that changed.
