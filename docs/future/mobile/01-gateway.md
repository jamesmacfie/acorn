# Phase 1: give a browser a way to reach a Node

Date: October 17, 2026. Status: shipped October 21, 2026.

## Completion note

Completed October 21, 2026. [Mobile gateway](../../relay/phone-channel.md) owns the shipped
behavior. This page keeps what the later phases need.

### What landed

- `apps/mobile`, the `@acorn/mobile` package, with the gateway in `apps/mobile/src/gateway`: the
  entry point and Node pairing in `main.ts`, the server in `gateway.ts`, phone sessions in
  `sessions.ts`, and the route denylist in `denylist.ts`, each with tests.
- `pnpm dev:mobile:gateway`, which attaches to the Node `pnpm dev` or `pnpm dev:node` runs.
- `pairInteractively` takes a device name, so the Node lists the gateway as "Acorn mobile on HOST".
  Its refusal outside a terminal no longer tells the person to run the CLI.
- `@acorn/node-core/server/auth/pairingCodes.ts` is exported, so the sign-in code reuses the Node's
  code store without loading the auth barrel's database modules.
- Two architecture rules: only `apps/mobile/src/gateway/` may import `@acorn/custody`, and the
  gateway logs through the logger.

The acceptance checks passed against a standalone Node: `curl` with the cookie read
`/node/v1/core/tasks` and wrote a preference, `curl` without it got `401`, and a revoke from a second
process closed the socket with code `4401` about 270 milliseconds after the command returned.

### Decisions and deviations

- **Sessions are one file each.** The file's modification time is "last used". A revoke deletes the
  file from another process, and touching a time can't bring a deleted file back the way a rewrite of
  one shared file could. The gateway checks open sockets every 500 milliseconds.
- **The denylist has two routes beyond the four families.** `PUT /v1/core/node/reach` joins security
  settings, and `POST /v1/core/node/stop` is a fifth family. The Node answers both only from a
  loopback peer, and the gateway is one, so forwarding them would let any phone pass that check. The
  pre-auth `/v1/pair` routes are in the pairing family for the same reason.
- **The default address is `http://127.0.0.1:4320`, not `localhost`.** In testing, `localhost`
  resolved to IPv6 and reached a different server on the same port. `--origin` names the address
  phones open, and the `Host` and `Origin` checks follow it.
- **The cookie has a 400-day `Max-Age`**, so a phone stays signed in across restarts, as phase 6
  tests. Sessions don't expire on the gateway. Revoking is the control.
- **`uqr` draws the QR code.** The repository had no QR encoder. `uqr` has no dependencies.
- **The gateway pings each socket every 15 seconds.** A phone that leaves the network doesn't close
  its socket, and its event viewer would hold one of the Node connection's viewer slots.
- **`kill -USR1 PID` prints a new sign-in code**, as it prints a pairing code on a standalone Node.
- **The package script is `gateway`, not `dev`**, because the root `pnpm dev` runs every package's
  `dev` task.

### What later phases need

- **Phase 2's transport.** `fetch` sends to `/node` plus the Node path, with an `x-request-id`
  header. Aborting the `fetch` aborts the Node request. The `/events` messages are in
  [relay events](../../relay/phone-channel.md). The first message on a socket is
  `{ status }`, which names the Node's ID. A close with code `4401`, or a `401 signed_out` from
  `/node`, means the phone is signed out and should show the sign-in screen.
- **Phase 2's fleet.** No gateway route returns the Node's fleet record. If `fleet.list` needs the
  label, add a small read-only route to `gateway.ts`.
- **Phase 2's dev server.** The `Host` and `Origin` checks must see one address. Run the gateway with
  `--origin` set to the Vite server's address, and proxy `/node`, `/session`, and `/events` without
  rewriting `Host`.
- **Phase 2's client code** goes in `apps/mobile/src/client`. The architecture rule refuses a
  `@acorn/custody` import anywhere outside `src/gateway/`.
- **The web app's files.** The gateway serves `apps/mobile/dist`, with `index.html` for any path
  without an extension. The packaged build in phase 6 needs a flag for another directory.
- **Phase 6.** Run the gateway with `--origin https://HOST.TAILNET.ts.net`. The `Host` check assumes
  `tailscale serve` passes the original `Host` through. Check that on the first real run.
- **Duplication.** Choosing and pairing the local Node takes about 15 lines in `main.ts` that repeat
  `openCliNode` in the CLI and `openNode` in the terminal client. A shared helper in
  `@acorn/custody/local` could serve all three.

## Goal

A browser on another device can read and write a Node's API and hold its event socket, without
seeing a device token or a certificate. A small gateway process on the Node's computer holds both.
The browser signs in to the gateway once with a one-time code and gets a session cookie. The Node's
auth and routes don't change.
