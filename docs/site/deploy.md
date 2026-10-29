# Deploying the public site

This page covers where `apps/site` runs, the workflow that deploys it, its secrets, and its response
headers. [The public site](../site.md) covers running, building, and checking it.

The site is a Cloudflare Worker with static assets, configured in `apps/site/wrangler.jsonc`. Its one
script, `apps/site/src/worker.ts`, runs only for download links. It counts each download and redirects
it to GitHub ([counting downloads](./releases.md#counting-downloads)).
`.github/workflows/site.yml` deploys it. The workflow runs on a pull request or a push to `main` that
touches the site or anything it reads from, such as `docs/`, `packages/protocol/`, or the kit. It
type-checks the site, then builds and tests the production and preview builds side by side.

- On a pull request, it uploads the preview build as a Worker version with the alias `pr-<number>`,
  and writes the preview URL to the job summary. Preview responses carry `X-Robots-Tag: noindex`. A
  pull request from a fork gets no preview, because it gets no secrets.
- On a push to `main`, once a day, and on each published release, it deploys the production build.

The workflow needs two repository secrets:

| Secret | What it holds |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An API token with the **Workers Scripts: Edit** permission on the account. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID. |

Wrangler runs through `pnpm dlx` at the version the workflow pins, so a normal install doesn't
download the Workers runtime.

`apps/site/public/_headers` sets the response headers: a Content Security Policy that allows only the
site's own origin, and a year of caching for the hashed files in `/_astro/`. HTML keeps Cloudflare's
default of revalidating on every request. The policy allows inline scripts and styles, because
Starlight writes its theme script and code block styles inline. `astro preview` ignores `_headers`, so
the Playwright tests don't exercise the policy.
