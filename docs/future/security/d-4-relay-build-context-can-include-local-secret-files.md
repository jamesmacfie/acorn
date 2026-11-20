# D-4. A relay build can include local secret files

Found November 20, 2026, in Acorn at `90b9e61e3` and `acorn-cloud` at `19fa594`. Severity is
medium, conditional on a local build context containing credentials. Status: the Acorn side is fixed,
and the `acorn-cloud` side is open.

On the Acorn side, `apps/relay/Dockerfile` copies five named paths, the root `.dockerignore` denies
everything else, and `docs/relay.md` builds from `git archive`.
[The November 20 review](../../security/review-2026-11-20.md) records the change. This report covers
the cloud deploy.

## Evidence and impact

The cloud's manual deploy instructions accept a developer's working checkout as the relay's build
context. If a local credential file sits in that context, a remote builder can receive it. Before the
Acorn fix, the image copied the whole context and the ignore file let through variants such as
`.env.local`, so an image already published from a working checkout may hold one. The review didn't
check whether any build contained a credential file.

## Fix and verification

In `acorn-cloud`:

- Build the relay from the Acorn commit the workflow resolved and tested, with
  `git archive --format=tar "$ACORN_SHA" | docker build -f apps/relay/Dockerfile -`, or from a fresh
  clone at that commit. [C-4](./c-4-cloud-deploy-can-use-untested-acorn-revision.md) resolves that
  commit once per run.
- Change the manual deploy instructions the same way, so a remote builder never receives a local
  checkout.
- Check any image already published from a working checkout for `.env*` and key files, and rotate
  whatever it held.

To check an image, run `docker run --rm <image> find /opt/acorn -name '.env*'`. It should print nothing.
