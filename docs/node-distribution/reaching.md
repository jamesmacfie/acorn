# Reach a Node from another machine

A Node answers on loopback until someone says otherwise. Binding beyond `127.0.0.1` puts a service that
runs PTYs, spawns agents, and executes repository commands on a network, so the Node never guesses. It
answers other machines only on hosts a person on its own computer chose. This page is part of
[Node distribution](../node-distribution.md).

There are three ways in from another machine: advertise the Node on a network you trust, below, open
an SSH tunnel to a private Node, or reach it through [a relay](../relay.md). A relay needs no inbound
port and no shared network, because the Node dials out to it.

## Choose the hosts

The hosts live in `advertiseHost` in the data root's `node.json`, as a comma-separated list. Three
things write it:

- `acorn node reach HOST...` sets the list, and `acorn node reach --private` clears it
  ([the local service](../cli/local-service.md#choose-who-can-reach-the-node)).
- The **Reachable from other machines** switch on the local Node's row in **Settings → Nodes** offers
  this machine's addresses and a field for a host name.
- On first boot at a terminal, a Node started by hand lists this machine's IPv4 addresses and asks
  which to advertise. Pressing Enter keeps it private, and that answer is recorded as an empty string,
  so the question doesn't come back. The Node skips the question without recording anything when
  there's no TTY (launchd, systemd, Docker, CI) or no network address to offer.

The command and the switch call `PUT /v1/core/node/reach`. It takes a device token from this computer
only, because a client elsewhere that narrows the list can lock itself out, and one that widens it
changes the machine's exposure from somewhere else. It refuses the whole list over one bad entry. A list
holds at most eight entries, and each is an IPv4 address or a DNS name with no scheme, port, path, or
wildcard. Loopback is refused, because the Node always answers on it. Each change writes a
`node.reach.changed` audit row.

The listener binds once at boot, so a change applies when the Node restarts. `acorn node reach`
restarts a Node the CLI started, and the switch restarts the desktop's Node. Until then,
`GET /v1/core/node/reach` reports `restartRequired`.

`ACORN_ADVERTISE_HOST` wins over `node.json`, so a container or a hand-written service unit can set the
hosts without touching the data root. While it's set, the route answers `409 reach_set_by_environment`,
and the switch shows the hosts but can't change them. A Node that `acorn node start` runs never sees the variable, because the
CLI removes it from the Node's environment. Use `acorn node reach` for that Node.

With hosts set, the listener binds `0.0.0.0` and accepts those names in the `Host` header as well as
loopback. Every other `Host` gets a 403, which keeps a DNS-rebinding page out. Only IPv4 addresses are
offered, because the answer ends up in a URL a person types and in a `Host` comparison.

## Keep the port

A Node with hosts keeps the port it last bound, because a client on another machine remembers the
address, port included. When another process holds that port at boot, the Node fails to start and names
that process. In the desktop, the recovery screen shows that message, and turning the switch off brings
back the fallback. A private Node moves to a free port instead, because its clients learn the address
from the Node. `ACORN_PORT` wins over both.

## Prefer a name

A DHCP lease can change an IPv4 address, and a client that dials the old one gets no answer. Prefer a
name: a `.local` name, a DNS name, or a Tailscale MagicDNS name. The `Host` check compares the exact
name, so the client must dial the name that's in the list.

On a tailnet, advertise the machine's Tailscale address or MagicDNS name, so the Node answers only
there.

## Open the firewall

The first time the Node listens on the network, the operating system's firewall might ask about it:

- On macOS with the firewall on, the system asks whether `node` may accept incoming connections.
- Windows Defender Firewall asks the same about `node.exe`.
- On Linux, open the port that `acorn node reach` prints, such as `sudo ufw allow 4317/tcp`, or
  `sudo firewall-cmd --add-port=4317/tcp --permanent` followed by `sudo firewall-cmd --reload`.

## Keep a Node private

A device bearer token and a rate-limited pairing code are what stand between the network and the Node,
so advertise only on a network you trust. Internal child tokens are accepted only from the socket's
loopback peer, even on an advertised listener. An SSH tunnel, `ssh -N -L <port>:127.0.0.1:<port>`,
reaches a private Node with no exposure, as long as the local and remote ports match, because the
`Host` guard compares the port too.
