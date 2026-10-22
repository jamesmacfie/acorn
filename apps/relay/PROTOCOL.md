# Relay protocol, version 1

This page specifies how a relay joins a client to a Node that has no public address. It's enough to
build a compatible relay, Node, or client without reading Acorn's code. [The relay](../../docs/relay.md)
covers how Acorn uses it.

A relay forwards bytes it can't read. A native client runs TLS to the Node inside the stream and pins
the Node's certificate, so the relay sees only ciphertext.

## Connections

Every connection is a WebSocket, over `wss://`, or `ws://` behind a proxy that terminates TLS. The
relay URL is the base for the paths below, and it may carry a path of its own. For a relay at
`wss://example.com/relay`, a Node registers at `wss://example.com/relay/v1/nodes/<route>`.

| Who | Path | What it is |
| --- | --- | --- |
| Node | `/v1/nodes/<route>` | The control connection. One per route, held open while the Node runs. |
| Node | `/v1/nodes/<route>/streams/<stream>` | The Node's end of one stream. |
| Client | `/v1/connect/<route>?kind=<kind>` | The client's end of one stream. |

A route names one Node at one relay. It matches `^[a-z0-9][a-z0-9-]{0,62}$`. An Acorn Node uses its
Node ID, a lowercase UUID.

Each connection proves who it is in its upgrade request:

```text
Authorization: Bearer <credential>
```

In self-hosted mode, the relay has one static credential, and Nodes and clients present the same one.
The relay compares it in constant time. A browser can't set this header, so a later version adds a
second way to carry the credential for browser streams.

## Register a Node

The Node opens its control connection. If another connection holds the same route, the relay closes
the older one with code 4000, `replaced`, and the newer one takes the route. A Node whose control
connection closes with 4000 has been replaced. It stops reconnecting and tells its operator.

## Open a stream

1. The client sends its upgrade request to `/v1/connect/<route>?kind=<kind>`. The relay holds the
   request and doesn't answer it yet.
2. The relay sends the Node a text message on its control connection:
   `{"type":"stream","id":"<stream>","kind":"<kind>"}`. The stream ID is 32 lowercase hex
   characters from a secure random source.
3. The Node opens `/v1/nodes/<route>/streams/<stream>`. The relay accepts it only from a Node holding
   the same credential, and only while the stream is waiting.
4. The relay completes the Node's upgrade, then the client's, and joins them.

A Node that won't take the stream answers on its control connection:
`{"type":"refuse","id":"<stream>","reason":"<text>"}`.

The relay answers the client's upgrade request with an HTTP status instead of `101` when it can't
open the stream:

| Status | Meaning |
| --- | --- |
| 400 | The path, route, or kind is malformed. |
| 401 | The credential is missing or wrong. |
| 404 | No Node holds that route. |
| 502 | The Node refused the stream. |
| 503 | The route already has the maximum number of open and waiting streams. |
| 504 | The Node didn't open its end within 10 seconds. |

## Stream kinds

The client chooses the kind. The relay checks only its syntax, `^[a-z][a-z0-9-]{0,31}$`, and passes
it to the Node.

| Kind | The bytes are |
| --- | --- |
| `tls` | A TLS 1.3 connection to the Node's HTTPS server. Native clients use it. |
| `browser` | Reserved for a browser's encrypted channel to the Node. |

A Node refuses a kind it doesn't serve.

## Carry bytes

Once joined, each binary message on one end is sent unchanged as a binary message on the other, in
order. Message boundaries carry no meaning, so a reader treats the stream as bytes. A text message
on a stream connection is a protocol error, and the relay closes both ends with code 1003.

Either end closes the stream by closing its WebSocket. The relay then closes the other end. A stream
doesn't half-close. TLS ends with its own `close_notify` first.

## Keep connections alive

The relay pings every connection every 30 seconds and closes one that hasn't answered the previous
ping. A Node pings its control connection on the same schedule and reconnects when the relay stops
answering.

A Node reconnects after 1, 2, 4, 8, 16, and then every 30 seconds, each with up to 20 percent random
jitter. It starts over at 1 second once a connection opens.

## Limits

| Limit | Value |
| --- | --- |
| Largest message | 1 MiB |
| Open and waiting streams for one route | 256 |
| Time for a Node to open its end of a stream | 10 seconds |

A message over the limit closes that connection with code 1009.

## Versioning

The version is in the path. Version 1 changes only by addition: a new message type, field, stream
kind, close code, or status. Every party ignores a message type or field it doesn't know. A breaking
change uses `/v2/`, and a relay serves each version its Nodes and clients still speak.

## What the relay knows

The relay knows routes, stream IDs, stream kinds, connection times, and how many bytes cross each
connection. It doesn't know the paths, methods, or bodies of the HTTP requests inside a stream.
