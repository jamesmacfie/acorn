# R-4: Signing out of the account leaves phone devices paired

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3`.
Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

Signing out, or turning off **Remote access**, closes the relay tunnel but leaves every phone's device
row active. A phone reaches the Node only through the account, so an owner who signs out because the
account was compromised expects that to cut phones off. Once remote access is back on, any phone token,
including a stolen one, works again.

## Who can do it

Someone who holds a phone's device token, or an unlocked phone, that the owner tried to cut off by
signing out. They need remote access turned back on, and an account session that can get a relay ticket
for the Node.

## How it goes

1. **Sign out** runs `turnOff`, which clears the relay settings and the owner record and stops the
   tunnel (`plugins/account/src/server/routes.ts:109-114`,
   `plugins/account/src/server/remoteAccess.ts:58-72`).
2. Stopping the tunnel ends every stream, so live channels close
   (`packages/node-core/src/server/transport/relayTunnel.ts:145-151`).
3. No step revokes a device. Rows with `kind: phone` stay active
   (`packages/node-core/src/server/auth/deviceTokens.ts:157-199`).
4. The owner resets the account's password and turns remote access on again
   (`plugins/account/src/server/remoteAccess.ts:44-55`).
5. The old phone token opens a channel and authenticates as before.

## What limits it

- A phone unused for 30 days is revoked the next time it asks
  (`packages/node-core/src/server/auth/deviceTokens.ts:180-183`).
- The owner can revoke each phone from **Settings → Nodes** on a computer.
- The control-plane doc states that sign-out revokes no device token.

## Fix

In this repository, in the account plugin's sign-out route
(`plugins/account/src/server/routes.ts`), revoke every device with `kind: phone` after `turnOff`. Phones
can't reach the Node without the account, so their tokens are worthless after sign-out anyway. Turning
off **Remote access** without signing out can keep phones, or ask, because the owner may turn it back on
a minute later. Update the doc below to match.

## How to check the fix

- Unit: in the account plugin's route tests, pair a phone device and a computer device, call
  `POST /v1/p/account/sign-out`, and check that the phone is revoked and the computer isn't.
- Live: in `pnpm dev:agent`, pair a phone, sign out, sign in, turn on remote access, and check that the
  phone has to pair again.

## Related

- [R-1](./r-1-account-website-runs-code-through-a-phone.md): what a phone token can do.
- [R-5](./r-5-revoke-leaves-proxied-sockets-open.md): what revoking a device does and doesn't close.
- Docs that make a claim this finding contradicts or that need updating with the fix:
  - [The account service](../../security/control-plane.md#the-account-service) says sign-out "doesn't
    revoke a device token, because device tokens don't depend on the account"
    (`docs/security/control-plane.md:68-69`). A phone's token does depend on the account in practice.
  - [What a phone device may do](../../relay/phone-channel.md#what-a-phone-device-may-do) lists the ways a
    phone's device ends.
