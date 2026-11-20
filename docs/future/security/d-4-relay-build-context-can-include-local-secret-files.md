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
