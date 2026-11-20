# R-9: The Node fetches whatever certificate authority address the account service names

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da`.
Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

A Node with **Remote access** on asks the account service which certificate authority to order its
preview certificate from. It then sends requests to that address, and to every address that answer
names, from the owner's computer. The address is checked only for being a URL. A breached account
service can make each Node send `GET`, `HEAD`, and `POST` requests to addresses on the owner's own
network.

## Who can do it

The account service's operator, or anyone who breaches it. Every Node with **Remote access** on asks at
start and at least hourly, with no person involved.

## How it goes

1. `fetchPreview` reads `acmeDirectory` from the service without a credential
   (`packages/node-core/src/server/transport/preview/accountPreview.ts:9-14`). The schema asks for a
   URL and nothing more (`packages/protocol/src/device/account.ts:139`).
2. The certificate manager passes it to the ordering code
   (`packages/node-core/src/server/transport/preview/certificate.ts:107`).
3. The ordering code fetches the directory, then the nonce, account, and order addresses the directory
   names (`packages/node-core/src/server/transport/preview/acme.ts:41-56`, `:110-111`). None is held to
   the directory's host, to `https`, or away from private and loopback addresses.

## What limits it

- The attacker doesn't see the answers. A failure's first 200 characters go to the Node's log and the
  certificate manager's last error (`packages/node-core/src/server/transport/preview/certificate.ts:139`),
  and no route returns either to the service.
- The request bodies are signed ordering messages, not text the attacker chooses.
- The manager retries a failure after one minute, then five, 15, and 60, so it isn't a fast scanner.

## Fix

In `packages/node-core/src/server/transport/preview/acme.ts`:

- Require `https` for the directory and for every address it names.
- Require every address the directory names to share the directory's host.
- Refuse a directory whose host is a loopback, private, or link-local address. A development flow that
  runs its own authority on this computer can pass an explicit option to allow it, as the tests do.

## How to check the fix

- In `packages/node-core/src/server/transport/preview/certificate.test.ts`, answer the preview route
  with `http://169.254.169.254/` and with a directory that names another host for `newNonce`, and expect
  no request to either.

## Related

- [R-6](./r-6-previews-put-the-cloud-inside-tls.md): what else the account service decides about
  previews.
- [Previews in the account API](../../account-api/previews.md#the-domain).
