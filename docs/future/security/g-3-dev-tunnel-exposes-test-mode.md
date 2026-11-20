# G-3: The Slack dev tunnel can publish the service's test routes

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3` and
`acorn-cloud` at `19fa594`. Severity: medium, only while the dev setup runs with `TEST_MODE=1`.
Confidence: plausible. Status: open.

## What goes wrong

The account service refuses `TEST_MODE` only when `BASE_URL` isn't on this computer. The Slack dev
setup keeps `BASE_URL` on `localhost` and publishes the whole service at `slack-dev.getacorn.dev`
through a Cloudflare tunnel, so the check passes while the service is public. With `TEST_MODE=1`,
anyone on the internet can call the test routes: sign in as any account, link any Slack user to any
Node, and replace a workspace's bot token. Without `TEST_MODE`, the tunnel still publishes the site
with the development defaults, because the https checks don't run either.

## Who can do it

Anyone on the internet, while the stage 3 setup runs with `TEST_MODE=1`. Sending a prompt that runs on
the owner's Node also needs membership of the `acorn-dev` Slack sandbox, because events must come from
Slack with a valid signature.

## How it goes

1. `acorn-cloud:src/env.ts:63` refuses `TEST_MODE` when `BASE_URL`'s host isn't local, and
   `acorn-cloud:src/env.ts:64-69` applies the production checks only to an https `BASE_URL`. Neither
   looks at `SLACK_PUBLIC_URL`.
2. Stage 3 keeps `BASE_URL=http://localhost:8787` and sets `SLACK_PUBLIC_URL` to the tunnel
   (`acorn-cloud:docs/future/slack/README.md:182-186`). That page says "`TEST_MODE` and the
   development defaults still apply". The tunnel forwards every path to `localhost:8787`
   (`acorn-cloud:docs/future/slack/README.md:206`).
3. With `TEST_MODE=1`, the attacker starts a device flow, then posts its user code to
   `/_test/approve` with `login` set to the owner's email. The route approves it for the account with
   that email (`acorn-cloud:src/app.ts:88-98`, `accountFor` at `app.ts:47-60`). Redeeming the device
   code gives the attacker an access token for the owner's account.
4. With that token, the attacker calls `POST /slack/v1/links` for the owner's Node
   (`acorn-cloud:src/slack/gateway.ts:322-334`) and opens the link with `?team=<sandbox team>&user=<their
   Slack ID>`. In `TEST_MODE` that links any Slack user without Slack sign-in
   (`acorn-cloud:src/slack/gateway.ts:486-492`).
5. The attacker's mentions in the sandbox now reach the owner's Node as the owner's own messages, and
   start agent turns there.
6. Separately, `POST /_test/slack/install` overwrites any workspace's install row, bot token included
   (`acorn-cloud:src/slack/gateway.ts:628-637`), and `POST /_test/session` gives a website session for
   any email (`acorn-cloud:src/app.ts:65-86`).

## What limits it

- The stage 3 command in `acorn-cloud:docs/future/slack/README.md:276-277` doesn't set `TEST_MODE`. The
  risk needs someone to combine stage 2's `TEST_MODE=1` with stage 3's tunnel.
- In stage 3 the relay is on `127.0.0.1`, so a ticket for the owner's Node doesn't reach it from
  outside.
- Without `TEST_MODE`, forging a website cookie with the development `AUTH_SECRET` still needs a real
  session token from the database, and sign-in codes go to the service's log, not to the attacker.

## Fix

In `acorn-cloud`, in `src/env.ts`, treat a non-local `SLACK_PUBLIC_URL` as a public service:

1. Refuse `TEST_MODE` when the raw `SLACK_PUBLIC_URL`, before the transform at `env.ts:78`, names a host
   outside `LOCAL_HOSTS`.
2. Apply the https checks at `env.ts:64-69` when either `BASE_URL` or `SLACK_PUBLIC_URL` is https.
3. Change the sentence in `acorn-cloud:docs/future/slack/README.md:184-185` to say stage 3 can't run in
   `TEST_MODE`.

As a second guard, answer `/_test/*` only to requests from the loopback address.

## How to check the fix

- Unit test for `readEnv`: `TEST_MODE=1`, `BASE_URL=http://localhost:8787`, and
  `SLACK_PUBLIC_URL=https://slack-dev.getacorn.dev` throws. The same without `TEST_MODE` and with the
  development `AUTH_SECRET` throws too.
- Live: start stage 3 as documented, then `curl -X POST https://slack-dev.getacorn.dev/_test/session`
  and expect the site's 404.

## Related

- [G-4](./g-4-sent-link-ties-slack-user-to-wrong-node.md), the same link page without the test shortcut.
- [The Slack gateway API § The stand-in](../../account-api/slack-gateway.md#the-stand-in).
