> **Completion note, November 20, 2026.** Bounded on the Acorn side, on branch
> `phase-r-6-previews-keep-the-cloud-outside-tls`. The finding is latent, and no Node change makes a browser
> pin a key, so this is a guard and a documented boundary, not a redesign.
>
> What landed:
>
> - Previews have their own switch, off by default. `node.json` gets an optional `previews: true`
>   (`nodeIdentitySchema`). The account plugin answers `PUT /v1/p/account/previews` with `{ enabled }`. It's for
>   paired devices only. A task token gets `403`, and a phone without shell access gets R-1's
>   `403 phone_refused`, because the plugin names no phone writes. Turning it on with remote access off answers
>   `409 remote_access_off`. Turning remote access off, or signing out, clears it, and turning remote access
>   on again leaves it off.
> - While the switch is off, the Node runs no preview code. `relayControl` in `listener.ts` starts
>   `startPreview` only with relay settings, an account service, and `previews` in `node.json`. So the Node
>   orders no certificate, publishes no DNS challenge, and destroys any preview stream the relay offers.
>   `PREVIEWS.open` answers `off`. `RelayControl.applyPreviews()` starts or stops previews to match the file
>   without restarting the tunnel, so a desktop that flips the switch through the relay keeps its connection.
> - **Settings → Account** shows a **Phone previews** switch under **Remote access** while that's on. Its text
>   says the account service can read a preview and use the app. The `off` message on the phone names both
>   switches.
> - Docs: `phone-channel.md` § Previews has the switch and a "Who can read a preview" section. `relay.md`
>   § What the relay can and can't see, `control-plane.md` § The account service, `account-api.md`, and
>   `account-api/previews.md` no longer say the service and relay can't read preview traffic. `relay/accounts.md`,
>   `data-root.md`, `mobile.md`, `mobile/phone-setup.md`, the `dev:account` hint, and the site's Account,
>   Machines, and environment variables pages describe the switch. The other pages `stale` listed don't describe
>   previews or `node.json`'s relay fields, so I marked them checked without changes.
> - Tests: `listener.test.ts` turns remote access on with an account service and the switch off, and checks
>   that `PREVIEWS.open` answers `off`, no preview starts, and a preview stream is destroyed. It then flips the
>   switch on and off with no new tunnel. It fails on the old code. `plugins/account/src/server/routes.test.ts`
>   covers the default, the `409`, the flip, the task token's `403`, and clearing with remote access.
>   `apps/relay/src/previewEndToEnd.test.ts` checks, through a real relay and account stub, that remote access
>   alone gets `503 off` with no challenge published and no certificate issued, then turns previews on.
>
> Decisions and deviations:
>
> - The switch lives in `node.json` beside `relay` and `owner`, not in the database, because the listener reads
>   it at boot before any plugin runs.
> - A Node whose relay is set by hand, in the environment or `node.json`, has no Remote access switch, so it
>   turns previews on by writing `"previews": true` into `node.json`. The docs say so.
> - The `off` reason still covers "no remote access", "no account service", and "switch off". I didn't add a
>   reason, because the pane only shows the message.
> - I didn't build the optional certificate-log watcher. It detects the attack and doesn't stop it.
> - Size: the Node service bundle grows by 579 B, from 1,970,326 B to 1,970,905 B. That's the listener's
>   on/off path and the account route.
>
> For later phases: L-2 is still open, and the finding makes it a precondition for the hosted service serving
> previews. With this change, an agent that steals the relay credential can still order a certificate from the
> account service directly. The switch only stops the Node from doing so. Any new caller of `RelayControl` must
> supply `applyPreviews`.
>
> What acorn-cloud would still need:
>
> - Before it serves previews, refuse `PUT /account/v1/preview/challenge` unless the owner turned previews on.
>   For example, the Node could report the switch with its registration, or the account website could hold its
>   own copy. Today a stolen relay credential is enough.
> - Say on the account website, where a person turns on remote access or opens a preview, that the service can
>   read previews.
> - Optional: watch certificate transparency logs for the preview domain and alert on a certificate no Node
>   ordered.

# R-6: Previews put the account service inside the encryption

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da` and
`acorn-cloud` at `19fa594`. Severity: medium, latent. Confidence: follows from the design, not run
live. Status: open. The hosted service doesn't serve previews at that commit.

## What goes wrong

On every other remote path the relay carries bytes it can't read, because the client pins the Node's own
key. A preview is different. Its name sits under a domain the account service owns, and a public
certificate authority vouches for it. Whoever controls that domain's DNS can get a second valid
certificate for the same name and stand between the phone's browser and the Node. From there they read
the preview's entry key and cookie and use them at the Node, which then proxies their requests to the
task's dev server as a local caller.

## Who can do it

The account service's operator, or anyone who breaches it or its DNS. They need a phone to open a
preview while they are in the path. An agent that stole the Node's relay credential gets part of the
way, as [L-2](./l-2-read-block-exposes-relay-credential.md) describes.

## How it goes

1. A Node serves previews on `*.<node>.<preview domain>`. The account service names the domain and the
   certificate authority (`packages/node-core/src/server/transport/preview/accountPreview.ts:9`), and it
   publishes the DNS record that proves the name
   (`packages/node-core/src/server/transport/preview/certificate.ts:111`). It can publish the same proof
   for a key of its own.
2. The relay, run by the same party, routes a browser's connection by the server name
   (`apps/relay/src/relay.ts:292-321`). It can end that connection itself with the second certificate.
   The browser shows nothing unusual.
3. The first request carries the one-time entry key in its address, and later ones carry the cookie
   (`packages/node-core/src/server/transport/preview/previewServer.ts:74-88`). The party in the middle
   reads both and replays them to the Node.
4. The Node proxies each request to the dev server with `Host: localhost:<port>`, from loopback
   (`packages/node-core/src/server/proxy/loopbackProxy.ts:71-86`). A dev tool that opens a console, a
   file listing, or a debugger to local callers opens it to this one.

The relay credential alone authorizes publishing the DNS proof
(`packages/node-core/src/server/transport/preview/accountPreview.ts:17-24`,
`packages/node-core/src/server/transport/listener.ts:256-263`). The same credential takes the Node's
route at the relay. So an agent that read it from `node.json` can get a certificate for the Node's
preview names and answer on them. The Node's code for this exists at this commit, which is the condition
L-2 names for its severity to rise.

## What limits it

- `acorn-cloud` answers `404` for the preview routes (`acorn-cloud:src/api.ts:306-308`), so no Node gets
  a certificate from the hosted service at that commit.
- The reach is the task's dev server, not the Node's API. No route of the Node answers on a preview name.
- A certificate issued for the name appears in the public certificate logs.
- A grant lasts 12 hours and ends when the Node restarts.

## Fix

No change makes a browser pin a key, so the fix is to bound the exposure and say what it is:

- Give previews their own switch, off until the owner turns it on, separate from **Remote access**. A
  person who wants a phone to reach their Node hasn't agreed to put a dev server behind a public name.
- Fix [L-2](./l-2-read-block-exposes-relay-credential.md) before the hosted service serves previews, so
  an agent can't order a certificate.
- Fix [L-6](./l-6-agent-retargets-an-open-remote-preview.md), so a stolen cookie reaches one port.
- Correct the pages listed under Related. They say the relay learns names and times only.
- Optional: have the Node read the certificate logs for its label and warn about a certificate it didn't
  order. That detects the attack and doesn't stop it.

## How to check the fix

- A unit test that `PREVIEWS.open` answers `off` on a Node with **Remote access** on and the preview
  switch off.
- The checks in L-2 and L-6.
- Read the corrected pages against this report.

## Related

- [R-1](./r-1-account-website-runs-code-through-a-phone.md) and
  [R-2](./r-2-account-service-relays-a-pairing-and-keeps-the-token.md): the other ways a breached
  account service reaches a Node.
- Docs that make a claim this finding contradicts:
  - [Previews](../../relay/phone-channel.md#previews) says the relay "passes the bytes on by name and
    reads only the server name in the first record" (`docs/relay/phone-channel.md:112-114`), and lists
    what the relay learns as names and times (`docs/relay/phone-channel.md:168`).
  - [What the relay can and can't see](../../relay.md#what-the-relay-can-and-cant-see) says a relay
    breach gives away who connected when, not what they did (`docs/relay.md:143-146`).
  - [The account service](../../security/control-plane.md#the-account-service) says the service can't
    read relayed traffic (`docs/security/control-plane.md:50-51`).
- [Previews in the account API](../../account-api/previews.md).
