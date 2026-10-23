# Test an account service

This page covers the stand-in account service and the conformance suite that holds every implementation
of [the account API](../account-api.md) to its schemas. Read it before you build a service, or when a
flow needs an account service and you don't want the hosted one.

## The stand-in

`startAccountStub` in `packages/node-core/src/testkit/accountStub.ts` is an account service for tests
and for `pnpm dev:agent` flows. It keeps everything in memory, signs with a key made at startup, and
approves a device flow at once for one test account. Every request is parsed by the schemas above, so a
client that changes what it sends fails in a test.

```ts
const account = await startAccountStub()
account.setRelayUrl(`ws://127.0.0.1:${relay.port}`)
const { accessToken } = await account.signIn('another-login')
```

`pnpm dev:account` starts it with a relay on fixed ports, 48781 for the service and 48782 for the relay,
prints the address to give a Node as `ACORN_ACCOUNT_URL`, and runs until you stop it. It also serves previews for them:
a relay listener on 48784 (`ACORN_DEV_PREVIEW_PORT`) for names under `preview.localhost`, which a browser on this
computer resolves to loopback, and a stand-in certificate authority. It writes that authority's certificate to
`acorn-dev-acme-ca.pem` in the temporary folder and prints the path. A browser accepts a Node's preview
certificate only if it trusts that file, or ignores certificate errors, as Playwright's `ignoreHTTPSErrors` does. Set
`ACORN_DEV_RELAY_URL` when something sits in front of the relay, such as a tunnel a real phone reaches this
computer through, and Nodes and phones are told that address instead.

`account.setPreview({ domain, acmeDirectory })` sets what `GET /preview` answers, and `undefined` makes the
stand-in a service with no preview domain. `account.challenges()` holds the TXT records Nodes have published,
by name, which is what a certificate authority would look up. `startFakeAcme` in the same testkit is a
certificate authority that speaks ACME for one DNS-01 order and reads those records, so a Node gets a real
certificate in a test with no internet. It checks each request's signature, nonce, and address, and signs with
a CA of its own that a test trusts through `caPem`.

A browser can sign in too. `GET /account/v1/browser/sign-in?next=/` signs in the test account at once and
sends the browser back to `next` with a session cookie, which is what the phone app's **Sign in** does
([browsers](./browsers.md)).

## Conformance tests

`packages/node-core/src/testkit/accountContract.test.ts` holds every implementation to the schemas. It
runs against the stand-in by default. To run it against another service, set
`ACORN_ACCOUNT_CONTRACT_URL=<base URL>`:

```sh
ACORN_ACCOUNT_CONTRACT_URL=http://localhost:8787 pnpm test:focus @acorn/node-core src/testkit/accountContract.test.ts
```

The suite approves device flows by posting `{ "userCode": "…", "login": "…" }` to `/_test/approve`, and
starts a browser session by posting `{ "login": "…" }` to `/_test/session`, which answers `204` with the
session cookie. Neither route is part of the API. A service answers them only when it runs in a test
mode, and the stand-in always does.
