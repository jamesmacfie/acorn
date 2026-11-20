> **Completion note, November 21, 2026.** Fixed on the Acorn side, on branch
> `phase-r-9-node-only-fetches-a-trusted-certificate-authority`.
>
> What landed:
>
> - `obtainCertificate` in `acme.ts` checks the directory address before it sends anything. It takes `https`
>   to a host that isn't a literal loopback, private, shared, link-local, or unspecified address. IPv4 written
>   as IPv6, such as `[::ffff:10.0.0.7]`, counts as the IPv4 address. Anything else throws
>   "isn't a certificate authority the Node will use", which reaches the manager's last error and the log.
> - Every request after that goes through one `fetchAcme` helper. It refuses any address whose origin differs
>   from the directory's, and sends with `redirect: 'error'`, so a redirect can't leave the origin either.
>   That covers the nonce, account, order, authorization, challenge, finalize, and certificate addresses.
> - The explicit option is `allowLoopback`. It lets an authority on this computer through over `http` or
>   `https`, and still refuses private and link-local addresses. The certificate manager sets it only when
>   the account service itself is on `127.0.0.1`, `localhost`, or `[::1]`. That is the same list
>   `accountServiceUrl` uses for a plain `http` service. So the stand-in authority in tests and
>   `pnpm dev:account` keeps working with no new setting, and a hosted service never gets the exception.
> - Tests in `certificate.test.ts` spy on `fetch`. The preview route answers `http://169.254.169.254/`, and the
>   Node sends no request there and publishes no challenge. A directory that names `localhost` and another
>   port for `newNonce` gets one request for the directory and none to the other server. Six direct cases
>   refuse plain `http`, `10.0.0.7`, `192.168.1.1`, `[fe80::1]`, `127.0.0.1` without the option, and
>   `[::ffff:10.0.0.7]` with it. All eight fail on the old code, which did send a request to 169.254.169.254.
>   `apps/relay`'s preview end-to-end test passes unchanged.
> - Docs: `account-api/previews.md` § The domain states the rule, and `account-api/testing.md` says why the
>   stand-in authority on `http://127.0.0.1` is accepted. `relay/phone-channel.md` is at 200 lines, so I left
>   it alone. No site page cites the changed files.
>
> Decisions and deviations:
>
> - "Share the directory's host" is an origin check, so scheme and port must match too. Public authorities
>   serve every ACME address from the directory's origin, so I chose the stricter rule.
> - I derived `allowLoopback` from the account service address instead of adding an environment variable. A
>   service on this computer is one the owner runs, so the breached-service case doesn't apply to it.
> - Only literal addresses are checked. A public name that resolves to a private address still passes. A
>   code comment marks this as a shortcut. Closing it means resolving the name and pinning the address for
>   every request, and the origin rule already keeps every later request on that one name.
> - Size: the preview code loads on demand, so the Node service bundle stays at 1,972,223 B.
> - I didn't run a live check in `pnpm dev:agent`.
>
> For later phases: any new code that fetches an address the account service names can copy the
> `checkDirectory` shape. `acme.ts` doesn't export it.
>
> What acorn-cloud would still need: nothing for this fix. The hosted service must answer `GET /preview` with
> an `https` directory on a public host, and that directory must name its addresses on its own origin. Let's
> Encrypt's does.

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
