# R-7: The phone's refusal list skips plugin routes and the event socket

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da` and
`acorn-cloud` at `19fa594`. Severity: low for reach, because a phone can already open a terminal. It
adds a way in that outlives the phone, and it decides whether the fix for
[R-1](./r-1-account-website-runs-code-through-a-phone.md) holds. Confidence: confirmed from code.
Status: open.

## What goes wrong

A phone's device is held to fewer routes than a computer's. The list that does it names core routes
only, and one middleware reads the phone mark. Every plugin route that asks for a device takes a phone,
and the event socket never learns that a connection is a phone's. So a phone can change the Node's
account and Slack settings, which are the settings that decide who else can reach the Node.

## Who can do it

Anyone with a phone's device token: script on the account website, as in R-1, or a person holding an
unlocked phone.

## How it goes

1. `devicePrincipal` puts `deviceKind: 'phone'` on the principal
   (`packages/node-core/src/server/middleware/auth.ts:84`). `phoneRules` is the only reader
   (`packages/node-core/src/server/middleware/phoneRules.ts:44`).
2. Every entry in the list starts with `/v1/core/` (`packages/node-core/src/server/middleware/phoneRules.ts:12-21`).
   A plugin's routes live under `/v1/p/`.
3. The account plugin gates its routes with `requireDevice` and nothing more
   (`plugins/account/src/server/routes.ts:41`). A phone can turn **Remote access** off, sign the Node
   out (`plugins/account/src/server/routes.ts:91`, `:109`), and ask for a relay ticket for any Node the
   account owns (`plugins/account/src/server/routes.ts:117`).
4. The Slack plugin does the same (`plugins/slack/src/server/settings.ts:38`). A phone can start a Slack
   link with approvals ticked, turn on **Answer approvals from Slack** for a linked team, and unlink
   (`plugins/slack/src/server/settings.ts:79`, `:112`).
5. The link route answers with an address on the account website. That page asks for the link's code
   and no account session (`acorn-cloud:src/slack/gateway.ts:481-514`). So whoever holds the phone's
   token can finish the link with a Slack user of their own, with approvals on. The link stays after
   the owner revokes the phone.
6. The socket's upgrade check returns the device ID and drops the kind
   (`packages/node-core/src/server/transport/wsHub.ts:378`), and a connection keeps only the ID
   (`packages/node-core/src/server/transport/wsHub.ts:115-119`). A phone's channel joins through the
   same check. Terminal input and container shells arrive as socket frames.

## What limits it

- A phone can open a terminal through `POST /v1/p/terminal/sessions`, so none of this adds reach at this
  commit.
- Signing the Node out cuts the phone's own connection. A second sign-in is refused while one exists
  (`packages/node-core/src/server/integrations/connections.ts:87-91`), so a phone can't move the Node to
  another account through the relay.
- A Slack link needs the Slack app installed in a workspace the attacker's Slack user belongs to, and
  the link shows in **Settings → Slack**.

## Fix

Do this as part of R-1, in this repository:

- Write the phone's allowlist over the whole of `/v1`, plugin routes included. Leave out the account
  plugin's writes, the Slack plugin's writes, `/v1/core/integrations` writes, and every route in
  `EXECUTION_ROUTES`.
- Carry the device kind on the socket connection, from `authorizeWsUpgrade` into `Conn`, and check it
  where terminal input and `docker:exec:*` frames are dispatched.
- Extend the test that pins the list to fail when a plugin registers a route the list doesn't name.

## How to check the fix

- In `packages/node-core/src/server/middleware/phoneRules.test.ts`, expect `403 phone_refused` for a
  phone on `PUT /v1/p/account/remote-access`, `POST /v1/p/account/sign-out`, `POST /v1/p/slack/link`,
  and `PUT /v1/p/slack/approvals`.
- In `packages/node-core/src/server/transport/wsHubSecurity.test.ts`, join as a phone's device and expect
  a terminal input frame to be refused.

## Related

- [R-1](./r-1-account-website-runs-code-through-a-phone.md), whose allowlist this constrains.
- [C-1](./c-1-phone-approves-its-own-pairing.md): a phone can mint a device that isn't a phone.
- [X-1](./x-1-account-takeover-to-slack-agent-turns.md): what a Slack link with approvals on allows.
- [What a phone device may do](../../relay/phone-channel.md#what-a-phone-device-may-do).
