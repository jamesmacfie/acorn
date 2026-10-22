# The phone gateway

This page covers `acorn mobile`, which serves the [mobile web app](../mobile.md) to phones. It's part of
the [command-line client](../cli.md). The command is in `apps/cli/src/mobile.ts`, and the gateway it
runs is in `apps/mobile/src/gateway`.

## Serve the app

```sh
acorn mobile [--node ID|LABEL|https://HOST:PORT] [--port N] [--origin https://HOST.TAILNET.ts.net] [--app-dir PATH]
```

The command starts the [mobile gateway](../security/mobile-gateway.md) and keeps it in the foreground.
It prints the address phones open, a QR code for it, and a one-time sign-in code, and stops when you press
Ctrl+C. [Use it on a phone](../mobile/phone-setup.md) has the Tailscale steps that give the address
a certificate a phone trusts.

| Option | Effect |
| --- | --- |
| `--node` | Serves a remembered Node, or an `https://` address it pairs with. The default is the Node running on this computer. |
| `--port` | Moves the gateway's loopback port from 4320. |
| `--origin` | The address phones open. The gateway refuses any other `Host`. The default is `http://127.0.0.1:PORT`. |
| `--app-dir` | The built web app. The default is the `mobile` folder beside the CLI's `cli.js`, which desktop staging and `pnpm pack:node` fill. |

The first time the gateway meets a Node it asks for a pairing code, as `acorn --node` does, so the first
run needs a terminal. The CLI runs the gateway as a child process, so a command that never serves a phone
doesn't load its server. Ctrl+C reaches both, and the CLI waits for the gateway to close its sockets.

## List and end sessions

```sh
acorn mobile sessions
acorn mobile revoke ID
```

`sessions` lists the signed-in phones, each with a 12-character ID. `revoke ID` ends one, and a running
gateway signs that phone out within a second. A session nobody uses for 30 days ends by itself. Neither takes `--node` or any other option.
