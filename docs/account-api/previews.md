# Previews in the account API

This page covers the two routes a Node calls to serve a task's app to a phone's browser under a preview
domain, and what a service must do for them. Read it before you build a service that offers previews. It's
part of [the account API](../account-api.md), and [previews on a phone](../relay/phone-channel.md#previews)
covers what the Node does with them.

## The domain

`GET /account/v1/preview` answers `{ domain, acmeDirectory }`: the preview domain, and the ACME directory its
DNS zone allows. The domain is a host name and an optional port with no scheme. The port is for a development
flow, and a certificate and a server name never carry one. A service with no preview domain answers
`404 not_found`, and a Node serves no previews against it. The route needs no authentication.

A Node's names are `<preview>.<node>.<domain>`. The `<node>` label is the first 32 hex characters of the
SHA-256 of `acorn-preview-node:` and the Node ID, so the service, the relay, and the Node each compute it
with no help.

## The challenge

`PUT /account/v1/preview/challenge` takes `{ value }`, the 43 base64url characters of an ACME DNS-01 answer. It
publishes the value as the TXT record `_acme-challenge.<node label>.<domain>`, replacing the last one, and answers
`204` once the record is being served. A certificate authority looks for it right after.

It authenticates with the Node's relay credential, in `Authorization: Bearer`, and with no person's token, so a
Node renews while nobody is signed in. The service takes the Node from the credential. A Node can publish under
its own label only, and a revoked or unknown credential gets `401 invalid_token`. A body with another field, or a
value of another shape, is `400 invalid_request`.
