# Relays and accounts

This page covers how a relay checks an account service, how a client gets a ticket, and what **Remote
access** does on a Node. Read it before you change the tickets a relay accepts or the account plugin's
routes. It's part of [the relay](../relay.md), and [the account API](../account-api.md) owns the
contract.

## Who may connect

A relay checks one of two things, chosen when it starts:

- **A static credential**, for self-hosted mode. Nodes and clients share it, and the relay compares it
  in constant time. See [run your own relay](../relay.md#run-your-own-relay).
- **An account service's keys.** A Node presents its relay credential and a client presents a ticket,
  both signed by the account service, and the relay verifies them with the service's public keys
  ([the account API](../account-api.md#signed-tokens)). Set `ACORN_RELAY_ACCOUNT_URL` to the service.

In account mode the credential names the Node ID and the account that owns it, and the ticket names the
Node ID and the account that may open streams to it. A route accepts a Node only with a credential
that names that route. A stream opens only when the ticket's account owns the Node registered on the
route. Either mismatch answers `401`.

The relay reads the service's keys when it starts and again when it meets a key it doesn't know, at most
every ten seconds. It polls the list of revoked credentials every ten seconds. A Node that holds a
revoked credential is closed with code 4001, and its streams close with it. A relay that can't read the
keys and the list when it starts doesn't start, because it would take a revoked credential. After that, an
outage leaves the last list in force and is logged, so a Node that reconnects while the service is down
still gets in.

A stream outlives nothing: when a Node leaves the relay, whether it closed its connection, was replaced,
or was revoked, every stream through it closes, and its clients lose the Node at once.

## Tickets

A client that reaches a Node through its account presents a ticket, not a credential. The address has
no credential in it:

```text
wss://relay.example.com/<node ID>
```

Custody asks the Node on its own computer for a ticket, through that Node's account plugin, and keeps
the ticket in memory. It asks when a stream needs one and a minute or less remains, so nothing runs on a
timer. The desktop and the terminal client ask this way. The browser extension's bridge asks the Node it
selected, or the one that listed the Node it selected, which it keeps connected for that. `acorn --node`
doesn't yet, and still needs the credential in the address when the relay is in self-hosted mode.
`NodeBroker` takes the route to ask through `relayTicketRoute`, because a library can't name a plugin's
route, and each app passes `ACCOUNT_TICKET_ROUTE` from the plugin's contract.

A ticket goes only to the relay the account service lists for the Node. An address that names another
relay is refused, and so is a `ws://` address for another computer, because the ticket would cross the
network in the clear. A relay on this computer can use `ws://`.

A fleet record for a Node reached with tickets keeps `relay: { url, route }` and no credential.

## Remote access

An owner who signs in to an account turns on **Remote access** for the Node in **Settings → Account**.
The Node registers with the account service, which answers with the relay's address, a relay credential,
and its public keys. The Node records them in `node.json` as `relay` and `owner`, and its tunnel starts
at once, without a restart. At every later boot the listener reads the same `relay` setting, so the
tunnel starts with no account code running.

Turning it off stops the tunnel and every stream it carries, deletes `relay` and `owner`, and removes the
Node from the account. The Node stops at once even when the account service can't be reached. In that
case the account page says so, and the Node stays listed until it's removed on the account website.

The page reads the tunnel's state, whether it is connected and since when, from
`GET /v1/p/account/state`. `GET /v1/node` doesn't report it, because that route answers before anyone
signs in. [The account API](../account-api.md#the-sign-in-plugin) says what the plugin does.

An owner who sets a relay in `node.json` or the environment keeps it. Remote access refuses to replace
one.
