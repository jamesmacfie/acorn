> **Completion note, November 21, 2026.** Fixed on the Acorn side, on branch
> `phase-r-7-phone-rules-cover-plugin-routes-and-the-socket`.
>
> R-1 had already closed most of this for a phone without shell access. Its allowlist covers `/v1/p`,
> the account and Slack plugins name no phone writes, and the event feed drops `term:input` and every
> `docker:exec:*` frame from such a phone. What R-1 left open was a phone with shell access. It could
> still sign the Node in or out, turn remote access on or off, ask for relay tickets, change connections,
> and make a Slack link with approvals on. Those decide who else can reach the Node, so they now refuse
> every phone.
>
> What landed:
>
> - A built-in plugin can register a route with `phone: 'refused'`. `pluginPhoneAccess` in
>   `routes/registry.ts` answers `refused` for any `POST`, `PUT`, `PATCH`, or `DELETE` under that mount,
>   and `phoneRefusal` refuses it before it looks at shell access. Reads stay open.
> - The account plugin and the Slack plugin register their settings routes with `phone: 'refused'`. That
>   covers sign-in, sign-out, remote access, phone previews, relay tickets, Slack link, confirm, unlink,
>   and approvals, and any write either plugin adds later.
> - `PHONE_REFUSED` has a new family, `Connections`, for every write under `/v1/core/integrations`.
> - Tests: `phoneRules.test.ts` covers the connections writes, a fake plugin with `phone: 'refused'`, and
>   the middleware's `403 phone_refused` for a phone with shell access.
>   `apps/node/test/integration/auth/phoneRoutes.test.ts` checks the real account and Slack routes,
>   including the four the verification section names.
> - Docs: `relay/phone-channel/phone-devices.md` lists the refused writes, and `security/control-plane.md`
>   says a phone with shell access still can't change them.
>
> Decisions and deviations:
>
> - I didn't refuse `EXECUTION_ROUTES` to every phone. R-1 chose a per-phone shell grant for those, and a
>   phone with shell access is meant to run commands.
> - The socket needed no change. R-1 carries `phoneWithoutShell` from `authorizeWsUpgrade` onto the
>   connection and drops shell frames in `wsViewerDispatch.ts`. Its test is in `wsHub.test.ts`, not
>   `wsHubSecurity.test.ts`. No socket frame reaches anything `PHONE_REFUSED` covers. A phone with shell
>   access typing into a terminal is what the grant is for.
> - A phone with shell access can no longer sign out, which R-4 and R-5 describe it doing. It still
>   reads every setting.
> - The integration test calls `pluginPhoneAccess` only, because node-core is at its 70-export cap and
>   `phoneRules` isn't exported.
> - The Node service bundle grows by 295 B, from 1,971,928 B to 1,972,223 B.
> - I didn't run the live check with a paired phone.
>
> For later phases: a built-in plugin whose writes decide who can reach the Node should register with
> `phone: 'refused'`. A loaded plugin can't, because the host drops `phone` for it, and its writes need
> shell access anyway.
>
> What acorn-cloud would still need: the Slack link page (`acorn-cloud:src/slack/gateway.ts`) asks for the
> link's code and no account session. A link started from a computer can still be finished by whoever
> sees that code. X-1's confirmation step on a paired device limits this on the Acorn side.

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
