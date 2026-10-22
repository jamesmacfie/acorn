---
title: Pair a device or a remote Node
description: Let other machines reach a Node, pair the desktop app, the terminal client, or the command line with it, and check the identity words that make pairing safe.
sources:
  - docs/authentication.md
  - docs/node-distribution.md
  - docs/node-distribution/reaching.md
  - docs/api-reference/transport.md
  - docs/cli.md
  - apps/node/src/entries/standalone.ts
  - packages/client-core/src/features/settings/nodes/NodesSettings.tsx
  - packages/client-core/src/features/settings/nodes/NodePairingCode.tsx
  - packages/client-core/src/features/settings/nodes/NodeReachSetting.tsx
  - packages/client-core/src/host/trust/PairingRequestDialog.tsx
  - packages/custody/src/local/pair.ts
checked: '6857132fe'
---

Pairing gives a client, such as the desktop app on your laptop, a token for a Node on another machine.
This page covers letting other machines reach the Node, pairing each kind of client, and what the token
it gets can do. The Node must already be running: see [Run a standalone Node](/docs/nodes/run-a-standalone-node/).

## Let other machines reach the Node

A Node answers only on its own machine until you say otherwise, because whatever reaches it can run
commands and agents there. On the Node's machine, choose one of these:

- **Run `acorn node reach`** with the addresses or names other machines should use, such as
  `acorn node reach 192.168.1.20 build.local`. With no addresses, it lists this machine's own, and
  `acorn node reach --private` makes the Node private again. A Node that `acorn` started restarts to
  use the change. Any other Node uses it after its next restart.
- **Turn on Reachable from other machines** in the desktop app. Open **Settings** > **Machines** >
  **Nodes**, turn it on in the row for this computer, pick an address or type a name, and click **Save
  and restart**. The row then shows the address to give the other machine.
- **Answer the question at first start.** The first time a standalone Node starts in a terminal, it
  lists the machine's IPv4 addresses and asks which one to answer on. Enter alone keeps it private. The
  Node records the answer in `node.json` and doesn't ask again.
- **Set `ACORN_ADVERTISE_HOST`**, such as `ACORN_ADVERTISE_HOST=192.168.1.20,build.local`, for a Node a
  container or a service unit starts with no terminal. It wins over the other choices. A Node that
  `acorn node start` runs never sees it, so use `acorn node reach` for that one.
- **Use an SSH tunnel** and keep the Node private: `ssh -N -L 4317:127.0.0.1:4317 build-box`. Use the
  same port on both ends, because the Node checks it. Set `ACORN_PORT` on the Node so the port stays
  the same.

The Node then listens on every network interface and refuses a request addressed to any other name. It
also keeps its port, because the other machine remembers the address. If another program takes that
port, the Node won't start until the port is free, and its error names that program.

Prefer a name to an address. A router can give the machine a new address, and the other machine must
connect with exactly a name on the list. On a Tailscale network, use the machine's Tailscale name, so
the Node answers only there.

The first time the Node listens on the network, the firewall might ask about it. On a Mac, allow `node`
to accept incoming connections. On Windows, allow `node.exe`. On Linux, open the port yourself, such as
with `sudo ufw allow 4317/tcp`.

What protects a reachable Node is the device token and the pairing code, so make it reachable only on a
network you trust.

## Get a pairing code

A pairing code works once, for 10 minutes, and allows five tries. Opening a new one closes the last.
There are three places to get one:

- **The Node's terminal.** A standalone Node prints a code when it starts with nothing paired yet, under
  **Pairing code**. With a device already paired, it prints the commands for a new one instead.
- **`acorn node pair` on the Node's machine.** It prints the Node's address, its identity, and a code,
  on every operating system, from a terminal acorn has paired with the Node. `acorn node pair --close`
  closes it early.
- **A desktop app already paired with the Node.** Open **Settings** > **Machines** > **Nodes**, and click
  **Pair another client** on the Node's row. The code shows with **Copy the code**, and **Close pairing**
  closes it early.

Both show the Node's identity: six words, such as `elbow caper hickory fjord clover gulf`. The client
you pair shows six words too. They must be the same. The words come from the Node's certificate, so
different words mean you're not talking to your Node. Comparing them is the one check acorn can't do
for you.

## Pair the desktop app

1. Open **Settings** > **Machines** > **Nodes** and click **Add a node**.
2. In **Node address**, type the address the Node prints under **Connect to**, such as
   `https://192.168.1.20:4317`, and click **Continue**.

   You should see **Does the node show these words?** with six words.

3. Compare them with the words the Node shows. Click **They match**, or **They don't match** to stop.
4. Type the code in **Pairing code**. **Name for this computer** is how the Node lists this device,
   and **Name for this node** is what this device calls the Node. Click **Pair**.

   The Node joins **Paired nodes**, marked **Live**.

With two Nodes paired, the top bar gets a Node picker and the left rail gets **Fleet**.

## Pair the terminal client or the command line

The terminal client and the command line share their paired Nodes, so pairing one pairs both.

1. In a terminal, run:

   ```sh
   acorn --node https://192.168.1.20:4317
   ```

   It prints the Node's address and **Identity** with six words.

2. Compare the words with the Node's, and type the code at **Pairing code**.

acorn remembers the Node by the name `192.168.1.20:4317`, so next time run `acorn --node
192.168.1.20:4317`, or use its ID. Add a command to run it against that Node, such as `acorn --node
192.168.1.20:4317 task list`. A script can't pair for the first time: it stops with **Pair
https://192.168.1.20:4317 in an interactive terminal first.** and exit code 3.

## Pair without a code on the same computer

When the Node runs on the same computer, and the desktop app or the terminal client is open and paired
with it, the terminal client, the command line, and the browser extension can ask instead.

1. Run `acorn` in a terminal. It prints three words, such as **Allow this in Acorn on this computer. It
   shows: maple river stone**, and also asks for a code.
2. The desktop app opens **Allow a new client?** with the client's name and the same three words. The
   terminal client asks the same question.
3. If the words match, click **Allow**. **Deny** refuses it.

The request lasts two minutes. Any program on the computer can ask, agents included, which is why the
words matter. If you didn't just start a client, click **Deny**.

## What a device token can do

A paired client has full control of the Node: it can do anything you can do in the app. The Node keeps
only a hash of each token. On your device:

- The desktop app keeps its tokens encrypted, with the key in the operating system's keychain.
- The terminal client and the command line keep theirs in their config folder, readable only by you
  ([Environment variables](/docs/reference/environment-variables/#the-terminal-client-and-the-command-line)).

On the Node's row in **Settings** > **Machines** > **Nodes**:

- **Unpair…** makes this device forget the Node. The Node keeps this device paired.
- **Revoke this client…** deletes this device's token on the Node, and closes its open connections.
  Coming back takes a new pairing code. Revoking your only device on a remote Node can lock you out of
  it.

In a terminal, `acorn node devices` lists the devices paired with a Node, and `acorn node revoke <id>`
revokes one. Revoking the terminal's own device needs `--force`.

Agents and the commands they run never get a device token. They get a token limited to their task.

## If a Node's identity changes

If a Node shows different words from the ones you paired with, acorn stops connecting to it. Its row
says **This node's identity changed.**, with the words it expected and the ones it got. If you rebuilt
that Node, unpair it and pair again, checking the words. If you didn't, something may be intercepting
the connection.

## In the terminal

The terminal client pairs with `acorn --node <address>`, as above. It can ask to be allowed, and it
shows the same question when another client asks. Its choice starts on **Cancel**, which denies the
request, so move to **Allow** to pair the other client.

## Limits

- A Node keeps its code in memory, so restarting it closes the code.
- On Windows there's no `kill -USR1`. Run `acorn node pair` for a new code.
- Pairing without a code works only on the Node's own computer, and only with a desktop app there to
  allow it.
- Every paired device has full control. There are no read-only devices.
