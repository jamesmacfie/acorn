# R-1: A breached account website runs code on the Node through a paired phone

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3`.
Severity: high. Confidence: confirmed from code. Status: open.

## What goes wrong

The phone app runs on the account website's origin. Any script on that origin can use the phone's
device token. A phone's device has every owner route except a short deny list, and that list leaves
terminals, run targets, project scripts, preferences, schedules, and agents open. So whoever controls
the files the account website serves can run commands on every Node that has a paired phone.

## Who can do it

- Anyone who can change the files the account website serves: its operator, someone who breached its
  hosting or build, or a supply-chain change in its dependencies. They need no device token of their
  own.
- Anyone holding an unlocked phone with the app open. They have the same reach through the app's own
  screens.

## How it goes

1. The phone keeps its device token in IndexedDB, encrypted under a browser key that script on the same
   origin can use but not export (`docs/relay/phone-channel.md:86-89`).
2. The served script decrypts the token, asks the account for a relay ticket, and opens a channel to the
   Node with the Node key the phone already pinned. The Node can't tell this script from the real app,
   because it learns who the phone is only from the device token inside the channel
   (`packages/node-core/src/server/transport/channel.ts:180-199`).
3. Each request becomes an ordinary call to the Node's router as a device principal
   (`packages/node-core/src/server/middleware/auth.ts:73-86`). A phone passes `requireDevice`, which
   checks only `kind === 'device'` (`packages/node-core/src/server/middleware/requireUser.ts:19-24`).
4. The phone deny list refuses pairing windows, devices, plugin writes, backup, security settings,
   `PUT /v1/core/node/reach`, and `POST /v1/core/node/stop`, and nothing else
   (`packages/node-core/src/server/middleware/phoneRules.ts:12-20`).
5. The script sends `POST /v1/p/terminal/sessions` and then `POST /v1/p/terminal/sessions/:sid/send`
   (`plugins/terminal/src/server/routes/terminal.ts:122`, `:146`). That's a shell as the owner. Writing a
   project's scripts through `POST /v1/core/projects` or `PUT /v1/core/projects/:id/config`
   (`packages/node-core/src/server/routes/projects/projects.ts:124`, `:165`) does the same with a delay.
6. From the shell, the `acorn` CLI's own device token file is readable, so the plugin-write refusal in
   step 4 doesn't hold either.

## What limits it

- The website operator has to change served files on purpose, and the change is visible in them.
- A phone left unused for 30 days is revoked the next time it asks
  (`packages/node-core/src/server/auth/deviceTokens.ts:180-183`).
- The owner can revoke a phone from **Settings → Nodes** on a computer.
- A Node with no paired phone isn't reachable this way.

## Fix

Treat shell access as a separate grant from pairing a phone. Check it at the Node for terminal
creation and input streams. A trusted desktop should approve the grant. Apply a separate approval
policy to phone-triggered agent commands that can reach the host.

- For phones without shell access, replace the deny list in `packages/node-core/src/server/middleware/phoneRules.ts` with
  an allowlist of the routes the phone's panes read and write. Leave out terminal sessions and their
  `send`, run targets, task setup, project and workspace writes, preferences, schedules, node providers,
  and agent spawns that can run commands. The comment at
  `packages/node-core/src/server/middleware/phoneRules.ts:5-10` and
  `docs/relay/phone-channel.md` § "What a phone device may do" say why the list is a deny list. An
  allowlist needs every route the phone's panes use named first.
- For phones granted shell access, say plainly in the docs listed below that a breach of the account website, or a stolen
  unlocked phone, means code execution on every Node with a paired phone. Consider serving the phone app
  in a form the account operator can't change without a signed release.

Either way, the work is in this repository.

## How to check the fix

- For an allowlist: extend `packages/node-core/src/server/middleware/phoneRules.test.ts` with cases
  showing that a phone principal gets `403 phone_refused` for `POST /v1/p/terminal/sessions`,
  `POST /v1/p/terminal/sessions/abc/send`, `POST /v1/core/projects`, `PUT /v1/core/projects/abc/config`,
  `PUT /v1/core/prefs/...`, and `POST /v1/core/schedules`. Add a case showing that a route outside the
  allowlist is refused by default.
- Live: pair a phone against `pnpm dev:agent` with remote access on, then try to open a terminal from the
  phone app and from the browser console on the app's origin.

## Related

- [C-1](./c-1-phone-approves-its-own-pairing.md): a phone can approve its own pairing request and mint a device that isn't a phone. With this
  finding, a breached account website can turn a phone token into a full device token that the phone
  rules and the 30-day limit don't cover.
- [R-2](./r-2-account-service-relays-a-pairing-and-keeps-the-token.md): a breached account service gets a device token by relaying a pairing, with no phone needed.
- [R-4](./r-4-sign-out-leaves-phones-paired.md): signing out leaves phone devices valid.
- [R-7](./r-7-phone-rules-skip-plugin-routes-and-the-socket.md): the plugin routes and socket frames an
  allowlist has to cover.
- Docs that make a claim this finding contradicts:
  - [The account service](../../security/control-plane.md#the-account-service) says the service can't
    get a device token (`docs/security/control-plane.md:50-51`).
  - [Trust](../../relay/phone-channel.md#trust) says the website "could ship a phone app that reads what
    the phone reads" (`docs/relay/phone-channel.md:172-174`). It can also act as the phone.
  - [What a phone device may do](../../relay/phone-channel.md#what-a-phone-device-may-do) and the comment
    in `phoneRules.ts` describe the list as covering "the ones that decide what code runs". Terminals and
    project scripts decide what code runs, and the list leaves them open.
