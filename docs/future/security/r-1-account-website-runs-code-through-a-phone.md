> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-r-1-account-website-can-t-run-code-through-a-phone`.
>
> What landed:
>
> - Shell access is a grant for one phone, apart from pairing. Migration `0019_phone_shell_access` adds
>   `devices.shell_access_at`. A computer gives or takes it with `PUT /v1/core/devices/:id/shell-access`,
>   from a new button in **Settings → Nodes**. No phone can reach that route. The Node audits
>   `device.shell.granted` and `device.shell.revoked`, clears the auth cache, and closes the phone's event
>   feed so it rejoins under the new grant. The principal carries `shellAccess`, and the device list
>   shows it.
> - The phone rules are an allowlist. `PHONE_REFUSED` still refuses device, plugin, backup, security,
>   reach, and stop routes to every phone. Without shell access, a phone may read anything except
>   through a loopback route such as the preview proxy, and may make only the writes that are named.
>   Core names its own in `PHONE_ALLOWED`. Each built-in plugin names its own in a new `phone` option on
>   `ctx.routes.register` and `ctx.routes.fetch`, read through `pluginPhoneAccess` in
>   `routes/registry.ts`. Every other write gets `403 phone_refused`, including routes added later. A
>   phone with shell access gets everything `PHONE_REFUSED` doesn't refuse.
> - The event feed drops every frame from a phone without shell access except attaching to and
>   detaching from terminal output and Docker logs and stats. That covers `term:input` and the editor's,
>   memory's, and Docker's own terminals, which each open a shell over the feed.
> - Agents, in `plugins/agents/src/server/sessions/phoneTurns.ts`. A turn from a phone without shell
>   access carries `fromPhoneWithoutShell`, which only the turn route writes. The engine fails it at
>   dispatch, and refuses to steer it, unless the session asks before every command (rank 0 on L-3's
>   scale). Such a phone can't answer a permission request or a workflow gate. It answers other requests
>   only in a session that asks first. It can't set a mode, or a requested option for the next start,
>   that runs commands without asking, and it can't rewrite a queued turn.
> - A task a phone without shell access makes gets `skipSetup`, because its worktree can check out
>   anyone's pull request and setup runs the project's script there.
> - Docs: the phone rules moved to `docs/relay/phone-channel/phone-devices.md`, with a new "Shell
>   access" section that says plainly what a grant risks. The landing page keeps the old anchors.
>   `control-plane.md`, `mobile.md`, `features.md`, the terminal client, the transport and core route
>   references, and `contribution-kinds.md` match.
> - Tests: `phoneRules.test.ts` covers the finding's cases, a route nobody named, and a fake plugin's
>   declarations and loopback mount. `apps/node/test/integration/auth/phoneRoutes.test.ts` checks the
>   real plugins' declarations, and `pairing.test.ts` drives the grant end to end. `wsHub.test.ts`,
>   `deviceTokens.test.ts`, `tasks.test.ts`, `phoneTurns.test.ts`, `managed.test.ts`, and
>   `NodeDevicesSetting.test.tsx` cover the rest.
>
> Decisions and deviations:
>
> - Reads stay open. The finding is about running code, and the Trust section already says the website
>   could read what the phone reads. A read allowlist would need every GET of 15 plugins named for no
>   gain against code execution.
> - A phone without shell access loses more than the finding lists: archiving and restoring tasks
>   (teardown and setup scripts), config trust, file edits, Docker actions, workflow gates and retries,
>   agent tools, and approving any agent command. Each runs a program or approves one. So **Needs you**
>   on such a phone answers questions only, and an agent in Auto takes no work from it.
> - `core never names a plugin` ruled out a core list of plugin paths, so each plugin declares its own.
>   The `phone` option is for built-in plugins only. The host drops it for a loaded plugin, which kept
>   the published plugin types unchanged. So the Database, API, Linear, and Rollbar panes are read-only
>   on a phone without shell access. Database queries and API requests run from the Node anyway.
> - A phone with shell access keeps the old reach. I didn't build a signed phone app release.
> - Notes and memory stay writable, and an agent reads both. That's prompt injection with a delay that
>   needs the owner's next turn, so I left it.
> - I didn't run the live check against `pnpm dev:agent` with a paired phone.
>
> For later phases: C-1 still lets a phone answer a pairing request, and `POST /v1/core/pair/requests/:id`
> sits in `PHONE_ALLOWED` for that. R-4 can reuse `setShellAccess` and `onShellAccessChanged` if signing
> out should also drop grants. A new built-in route that a phone's pane writes needs a `phone` entry, or
> the phone gets `phone_refused`.
>
> What acorn-cloud would still need: nothing for this fix. Serving the phone app from a signed,
> versioned release that the account operator can't change would protect phones with shell access too.

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
- Docs that make a claim this finding contradicts:
  - [The account service](../../security/control-plane.md#the-account-service) says the service can't
    get a device token (`docs/security/control-plane.md:50-51`).
  - [Trust](../../relay/phone-channel.md#trust) says the website "could ship a phone app that reads what
    the phone reads" (`docs/relay/phone-channel.md:172-174`). It can also act as the phone.
  - [What a phone device may do](../../relay/phone-channel.md#what-a-phone-device-may-do) and the comment
    in `phoneRules.ts` describe the list as covering "the ones that decide what code runs". Terminals and
    project scripts decide what code runs, and the list leaves them open.
