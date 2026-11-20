> **Completion note, November 20, 2026.** Fixed on the Acorn side. acorn-cloud still has to change
> how it builds the relay, as listed at the end of this note.
>
> What landed:
>
> - `apps/relay/Dockerfile` no longer runs `COPY . .`. It copies five paths: the root `package.json`,
>   `pnpm-lock.yaml`, and `pnpm-workspace.yaml`, then `patches`, `packages/protocol`, and `apps/relay`.
>   pnpm needs `patches` even for the relay alone, because it opens every file `patchedDependencies`
>   names. An install from only these paths was checked by hand. It installed six packages, and the
>   relay started from the result.
> - The root `.dockerignore` is a deny-all allowlist. It starts with `*`, opens the same five paths, and
>   then drops `node_modules`, `dist`, `.turbo`, logs, `.env*`, `.npmrc`, `*.pem`, `*.key`, `*.p12`, and
>   `*.pfx` inside them. Only the relay builds from the repository root, so a new local file at any depth
>   stays out of the context unless someone opens it on purpose.
> - The documented build in `docs/relay.md` and the Dockerfile header is
>   `git archive --format=tar HEAD | docker build -f apps/relay/Dockerfile -t acorn-relay -`. It sends
>   only committed files at the named revision. The ignore file protects anyone who still builds from a
>   working checkout.
>
> How it was checked:
>
> - `tools/arch/relayImage.test.mjs`, which runs in `pnpm test`, has five cases. Every `COPY` source is
>   tracked and on the exact list, and the image has no `ADD`. The ignore file opens exactly the `COPY`
>   sources and drops the credential patterns after its last opening rule. The docs and Dockerfile
>   name the `git archive` build. A fixture repository with 13 uncommitted decoys gives `git archive HEAD` only the seven committed files. The fifth case sends the same fixture
>   through Docker's own matcher with `FROM scratch` and `COPY . /`, exports the result, and expects
>   the same seven files. The decoys include `.env.local` at the root, an `.env.production.local`
>   and a `tls.key` in the relay folder, and an `.env.development` in the protocol package. Against the old Dockerfile, ignore file, and doc, the first three cases fail.
> - The Docker case skips when no engine answers. On this machine OrbStack reported itself running, but
>   its socket didn't answer a ping, so that case and a real image build didn't run. Nobody has yet
>   run a `docker build` of the relay with this Dockerfile, or the `git archive` pipe into
>   `docker build -`. Run both once on a machine with a working engine:
>   `pnpm --filter @acorn/arch-tests exec vitest run relayImage.test.mjs`, then the documented build,
>   then `docker run --rm acorn-relay find /opt/acorn -name '.env*'`, which should print nothing.
> - The landing page cites `docs/relay.md`, but it doesn't describe the container build, so it didn't
>   change.
>
> Decisions and deviations:
>
> - The allowlist lives in the root `.dockerignore`, not in a `Dockerfile.dockerignore` beside the relay's Dockerfile. The
>   classic builder ignores the per-Dockerfile file, and only the relay builds from the root.
> - The `.dockerignore` file isn't proof by itself. The `COPY` list also limits what the image keeps, so a
>   path the ignore file wrongly opened still couldn't reach the image unless the Dockerfile copied it.
> - The image still ships the relay's test files and `PROTOCOL.md`, because they're inside
>   `apps/relay`. They hold no secrets. Narrowing them would mean a longer list to keep in step.
> - D-3's runtime digest and C-4's single resolved commit are left to their phases.
>
> What acorn-cloud needs:
>
> - Build the relay from the Acorn commit the workflow resolved and tested, with
>   `git archive --format=tar "$ACORN_SHA" | docker build -f apps/relay/Dockerfile -`, or from a
>   fresh clone at that commit. Don't pass a developer's working checkout as the context. C-4 resolves
>   that commit once per run.
> - Change the manual deploy instructions the same way, so a remote builder never receives a local
>   checkout.
> - Check any image already published from a working checkout for `.env*` and key files, and rotate
>   whatever it held.

# D-4. A relay build can include local secret files

Found November 20, 2026, in Acorn at `90b9e61e3` and `acorn-cloud` at `19fa594`. Severity is
medium, conditional on a local build context containing credentials. Status is open.

## Evidence and impact

The cloud manual deploy instructions accept the working checkout as the relay's build context.
`apps/relay/Dockerfile` copies the context into the image. The repository's `.dockerignore`
excludes files named `.env` but permits variants such as `.env.local`.

If a developer has a local credential file in that context, a remote builder can receive it
and the published image can retain it. The review confirmed the inclusion rules from source.
It did not verify that any build has contained a credential file.

## Fix and verification

Build the relay from a clean, selected revision. Exclude local credential file variants from
the image context and copy only the sources required by the relay build.

Use a fixture with decoy credentials to test that the build sends no local credential files
and that the resulting image contains none.
