# Phase 4: refuse every plugin write from a phone

## Completion note

Done on October 22, 2026.

What landed:

- One rule in `DENIED_ROUTES` replaces the two install rules: `POST`, `PUT`, `PATCH`, and `DELETE`
  under `/v1/core/plugins`, in the family "Plugin settings". `GET` and `HEAD` pass.
- `denylist.test.ts` refuses every write route this doc lists, plus three spellings of the
  development route: an encoded letter, an encoded slash, and doubled slashes. `GET` of the roster and
  of a bundle by hash pass, and so does `HEAD` of a bundle.
- The mobile gateway reference lists the new family under **Refuse what a phone has no screen for**.
  No public site page cites the changed files.

Decisions and deviations:

- No path stays open. The phone has no screen that answers an install request. Its **Needs you** list
  reads attention sources and opens a target. Only the desktop's bell opens `PluginApprovalDialog`,
  which posts to `/requests/:requestId`. So that route is refused too, and the old test that forwarded
  it now expects a refusal.
- The rule names the four write methods rather than "everything but `GET` and `HEAD`". That keeps the
  rule in the list's existing shape. Every plugin route uses one of those four methods.

Checked live: a throwaway standalone Node with the gateway in front of it. The built phone app, signed
in, made one plugin request, `GET /v1/core/plugins`, which answered `200`. `curl` through the gateway
got `403 gateway_refused` for `PUT /node/v1/core/plugins/acme/development`, for `PUT` of the roster,
for reload, for an install request answer, and for `/node/v1//core/plugins/acme/%64evelopment`.

For later phases:

- Phase 6 can reuse the `curl` cases above. The gateway's denylist changed in no other way, and
  sessions and headers are untouched.

Date: October 22, 2026. Status: done. Severity: low.

The gateway refuses plugin installs, updates, reviews, and removals, because a phone has no screen
for deciding what code runs on the Node. Seven other plugin routes make the same kind of decision and
pass. This phase replaces the four install rules with one rule for every plugin write. Read
[the programme](./README.md) first.

## Starting point

Read at `47287b67c`.

- `DENIED_ROUTES` in `apps/mobile/src/gateway/denylist.ts` refuses `POST` to
  `/v1/core/plugins/install`, `/:id/update`, and `/:id/review`, and `DELETE /v1/core/plugins/:id`.
  `denylist.test.ts` pins the list.
- These write routes in `packages/node-core/src/server/routes/plugins/plugins.ts` pass the gateway:
  - `PUT /` turns plugins on and off.
  - `POST /:id/reload` replaces the code a plugin runs, and is audited like an install.
  - `PUT /:id/development` turns on development mode, which reloads on every file change and grants
    the plugin's inputs without a prompt.
  - `POST` and `DELETE /:id/input-grant`, `PUT` and `DELETE /:id/model-grant`, `PUT /:id/skills`, and
    `POST /:id/skill-grant` grant what a plugin reads and gives agents.
  - `POST /requests/:requestId` answers an agent's request to install a plugin.
  - `POST /:id/cli/:name` runs a plugin's CLI command.
- [The mobile gateway](../../security/mobile-gateway.md#refuse-what-a-phone-has-no-screen-for) gives
  the list's reason: a phone has no screen for these families. The phone doesn't run loaded plugins.
- This isn't a boundary against a stolen session, which can open a terminal anyway. Phase 3 handles
  that. It's about keeping a decision on the screen that explains it.

## Changes

1. Check what the phone calls first. Search `apps/mobile/src` and every client-core module the phone
   app loads for requests to `/v1/core/plugins`, and run the phone app in `pnpm dev:mobile` with the
   gateway's request log open. Expect only `GET` requests. If **Needs you** answers plugin requests
   with `POST /requests/:requestId`, keep that one path open and say why in the list.
2. Replace the two install rules with one: every method other than `GET` and `HEAD` under
   `/v1/core/plugins`, in the family "Plugin settings". Keep `GET` open, so the phone can still read
   the roster and bundles if it ever needs them.
3. Update the family list in [the mobile gateway](../../security/mobile-gateway.md#refuse-what-a-phone-has-no-screen-for).

Why one rule and not seven more: the next plugin write route someone adds is then refused by default,
and the test pins one rule instead of a list that drifts.

## Tests

In `apps/mobile/src/gateway/denylist.test.ts`, each write route above is refused, with encoded and
doubled-slash spellings, and `GET /v1/core/plugins` and `GET /v1/core/plugins/:id/bundles/:hash`
pass. If step 1 kept a path open, a case shows it passes.

## Acceptance

The phone app in `pnpm dev:mobile` works as before, and `curl` through the gateway gets
`403 gateway_refused` for `PUT /node/v1/core/plugins/acme/development`.
