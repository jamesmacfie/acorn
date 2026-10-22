# Accounts and sign-in

Date: October 22, 2026. Status: proposed. Taken from the accounts half of
[cloud identity](../cloud/identity.md) and from the first half of cloud's account service phase. This
file covers accounts, how each client signs in, how a local Node records its owner account, and the
two short-lived tokens the account service issues. Today acorn has no accounts at all
([authentication](../../authentication.md)).

## Accounts

The hosted service owns this part, so it describes behavior the account API exposes and the design
the hosted service follows ([services](./services.md#how-the-docs-refer-to-the-hosted-service)).

The account service owns an account ID that has no relationship to any OAuth provider's user ID.
GitHub is the first sign-in method. The schema and UI leave room for another OAuth provider, email
and password, account recovery, and a second factor.

Better Auth is the leading library. It has a Hono integration, a Drizzle adapter, explicit account
linking, and session management. One setting is mandatory: `disableImplicitLinking: true`. A matching
verified email alone never merges two accounts. A person links a second provider while signed in to
the first ([cloud refusal](../cloud/refused.md#no-automatic-account-merge-by-email)).

Teams, roles, and Better Auth's organization plugin belong to cloud. This programme has one person
per account and nothing shared.

For more information, see [Better Auth Hono integration](https://better-auth.com/docs/integrations/hono)
and [account linking](https://better-auth.com/docs/concepts/users-accounts). Recheck both before
phase 2.

## How each client signs in

| Client | How it signs in | Where the credential lives |
| --- | --- | --- |
| Account website and phone app | GitHub OAuth redirect. | An `HttpOnly`, `SameSite=Lax` session cookie on the account domain. |
| Desktop | The sign-in plugin on the local Node runs an OAuth device flow against the account service. The desktop shows the code and opens the browser. | An encrypted connection row on the local Node, like the GitHub token. |
| Terminal client | The same plugin and flow. The terminal client prints the code and URL. | The same connection row, on the Node it attached to or started. |
| `acorn` command line | Reads the same connection through the local Node. No separate sign-in. | Same. |
| Browser extension | Reads the same connection through its bridge and the local Node. The pairing screen offers **Sign in** when nobody has. | Same. |

Sign-in runs on the local Node, not in the client, for the reason
[control plane security](../../security/control-plane.md) gives: a provider's credential is an
ordinary connection held on the Node, so the desktop renderer and the terminal client's drawing code
never touch it. The GitHub connection already runs a device flow this way
([authentication](../../authentication.md#github-connection)), so the routes and the UI pattern exist.

Better Auth lists a device authorization plugin. Confirm it issues refresh tokens before relying on
it. If it doesn't, the account service implements RFC 8628 itself on top of Better Auth sessions.

## The sign-in plugin

A bundled first-party plugin, `plugins/account` (new), beside `plugins/github`. It:

- runs the device flow and stores the result as an encrypted connection;
- contributes the **Account** page in Settings, with **Sign in**, the account, and **Sign out**;
- contributes the **Remote access** switch on the local Node's row in **Settings → Nodes**;
- contributes a Node provider that lists the account's Nodes ([pairing](./pairing.md#your-account-lists-your-nodes));
- fetches relay tickets and account assertions for custody.

It's bundled so remote access needs no install step. It does nothing until someone signs in: no
outbound connection, no timer, no route that calls out. That keeps the rule that a Node with no
account runs no account code. Cloud's later work adds team Nodes and grants to the same plugin.

## The Node's owner account

Turning on **Remote access** records the signed-in account as the Node's owner account. The Node
registers itself with the account service: its Node ID, its TLS fingerprint, its channel key for the
phone ([phone](./phone.md#the-encrypted-channel)), and a label. The reply carries a relay credential
and the account service's current public keys.

The owner account isn't a grant and gives the account service no way in. The Node uses it for one
check only: whether a relayed pairing ask comes from its owner ([pairing](./pairing.md#ask-from-anywhere)).

Turning remote access off deletes the relay credential and the owner account record on the Node, and
removes the Node from the account's list.

## Relay credentials and tickets

| Token | Holder | What it proves | Lifetime |
| --- | --- | --- | --- |
| Relay credential | The Node | "I'm Node N, owned by account A." The relay accepts N's outbound connection. | Until remote access is turned off or the Node is removed on the website. |
| Relay ticket | A client | "Account A may open a stream to Node N." The relay checks that N's owner is A. | Five minutes. Custody refreshes it a minute before expiry and holds it in memory. |

A ticket lets the client reach the Node. It doesn't get the client in. The device token does that,
inside the encrypted connection, as today.

## Account assertions

An account assertion is a short-lived statement, signed by the account service with Ed25519, that a
person is signed in as an account. It carries the issuer, the Node ID as audience, the account ID as
subject, a unique ID, and an expiry two minutes after issue. The client sends it with a relayed
pairing ask, inside the encrypted connection.

The Node checks the signature against the keys it received at registration, the audience against its
own ID, and the subject against its owner account. An assertion grants nothing beyond raising a
pairing ask. It isn't a principal and never reaches the device token path. Cloud's grants are a
different token, with a different prefix, that local Nodes refuse
([cloud identity](../cloud/identity.md#grants)).

## Signing out and removing a Node

- **Sign out** on a client deletes the connection on that client's local Node and forgets every
  ticket. Devices already paired stay paired, because their device tokens don't depend on the
  account.
- **Remove** next to a Node on the account website revokes its relay credential. The Node drops off
  the relay at once and keeps working locally.
- Revoking a device stays where it is today, in **Settings → Nodes** on any paired device
  ([authentication](../../authentication.md#device-tokens)).

## Audit

The account service keeps its own record of sign-ins, Node registrations and removals, and ticket and
assertion issuance, without any task content. The Node writes an audit row for every relayed pairing
ask it accepts, with the account ID and the assertion's unique ID.

## Trust cost

The account service can issue a relay ticket for any Node and an assertion for any account. That lets
it route a client to a Node and raise a pairing dialog. It can't approve that dialog, read traffic,
or get a device token. What it could do, if breached, is vouch for an impostor Node so that you pair
with the wrong machine ([pairing](./pairing.md#trust-cost)).

## Verify before building

Check that Better Auth's device flow and session revocation behave as described here with the
current release. Check how `plugins/github` stores its connection, so the sign-in plugin follows the
same path.
