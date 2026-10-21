# Phase 5: clear the audit

Date: October 21, 2026. Status: proposed. Severity: low.

`pnpm audit --prod` at `32b2ab6c3` reports five advisories, one of them high-rated in a package the
app ships. None is reachable from the way Acorn calls its dependencies, but each is cheap to clear,
and a clean audit makes the next new advisory easy to spot. Read [the programme](./README.md) first.

## Starting point

| Advisory | Package | Where | Reachable |
| --- | --- | --- | --- |
| [GHSA-5r4p-p66f-jhc7](https://github.com/advisories/GHSA-5r4p-p66f-jhc7), moderate | hono 4.13.7, fixed in 4.13.11 | Pinned in `package.json` and `pnpm-workspace.yaml` overrides, used by the Node, the helper, and the MCP SDK | No. The advisory is in `serveStatic`, which no Acorn source calls. |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | braces up to 3.0.3 | `apps/site` through `starlight-llms-txt` and micromatch | No. Site build only. |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), high | source-map-js below 1.2.2 | `apps/site` through astro | No. Site build only. |
| [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), moderate | postcss-selector-parser below 7.1.6 | `apps/site` through expressive-code | No. Site build only. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge | Ignored with a reason since October 11 | No. Acorn never verifies a signature with it. |

## Changes

1. Move `hono` to 4.13.11 in both override lists, and in any package that names it. Route gates rely
   on how Hono matches `/*` against a bare path, which has moved between versions
   ([the gates](../../security/transport-and-auth.md#the-gates)), so run both mount coverage tests and
   the Docker gate test before anything else.
2. Add overrides for braces 3.0.4 or later, source-map-js 1.2.2 or later, and postcss-selector-parser
   7.1.6 or later, unless an upstream release of the site's dependencies already carries them. Prefer
   the upstream release.
3. Check whether node-forge has a fixed release. If it has, take it and remove the ignore.

`tools/arch/dependencySecurity.test.ts` checks that the two override lists agree, so it fails if you
update one and not the other.

## Tests

- `pnpm --filter @acorn/node-core test` for `server/mountCoverage.test.ts`, and the `apps/node`
  integration test `pluginMountCoverage.test.ts`.
- `plugins/docker/src/server/routes/docker.test.ts`, which reads the router's gates.
- `pnpm --filter @acorn/arch-tests test`.
- `pnpm pack:node`, which checks the Node service's size ceiling. A Hono patch release shouldn't move
  it much, but the ceiling is close.
- A site build.

## Acceptance

- `pnpm audit --prod` lists no advisory other than any that stays ignored with a written reason.
