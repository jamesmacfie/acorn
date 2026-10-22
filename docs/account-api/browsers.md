# Browsers and the account API

This page covers how a browser served by the account website calls [the account API](../account-api.md):
the session cookie, the header that goes with it, and where a person signs in. The phone app is the one
client that does. Read it before you change what the app calls, or build a service that serves it.

## Call the API from the website

The phone app is served from the account website's own origin, so it calls `/account/v1` there. A native
client sends an access token. A browser has none, so it sends the website's session cookie, which the
service set when the person signed in.

| Route | Cookie accepted |
| --- | --- |
| `GET /account/v1/account` | Yes |
| `GET /account/v1/nodes` | Yes |
| `POST /account/v1/tickets` | Yes |
| `POST /account/v1/assertions` | Yes |
| Every other route | No. A browser has no use for it. |

A request authenticated by the cookie must also carry `X-Acorn-Account: 1`. A page on another site can't
add a header like that without the service's say-so, because the browser asks first, so a cookie alone
never acts for the person. Without the header, the service answers `401 invalid_token` as it does for a
request with no session. A request with an access token needs no header.

The service decides the cookie's name and flags. It's `HttpOnly` and `SameSite=Lax`, and `Secure` over
HTTPS.

## Sign in

`GET /account/v1/browser/sign-in?next=<path>` starts the sign-in on the service's own page, where GitHub
signs the person in, and sends the browser back to `next` with the session cookie. `next` is a path on the
service's origin and nothing else, and the service refuses `//` and a full address.

The app sends a signed-out person there from its **Sign in** screen. The account page on the website does
the rest: the person's Nodes, **Remove**, and the browser sessions that list.

## Ask for a ticket

`POST /account/v1/tickets` answers with the relay's address and a ticket. The app opens its stream with that
ticket as a subprotocol ([the relay protocol](../../apps/relay/PROTOCOL.md#connections)), and the Node's
channel key from `GET /account/v1/nodes` is the key it pins ([the phone channel](../relay/phone-channel.md)).

## Why

A cookie is the right credential for a page the service itself serves, and the wrong one for anything else.
The header keeps a cookie from acting for the person when another site asks. Sign-in stays on the
service's page so the phone app never handles a GitHub credential.
