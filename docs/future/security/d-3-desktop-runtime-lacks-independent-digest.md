# D-3. Desktop runtime verification trusts the download source

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is low. The verification source is
confirmed from code. Status is open.

## Evidence and impact

`apps/desktop/scripts/node-runtime.mjs` downloads the Node runtime and its checksum from the
same release. It also accepts a cache entry that matches its locally written digest.
`node-runtime.json` pins the version without recording an independently trusted digest.

The checks catch corruption. A compromised download source could change both the binary and the
checksum, and a replaced cache entry could match its own digest. A packaged desktop could then
contain different runtime code from the intended release.

## Fix and verification

Record a reviewed digest for each supported runtime artifact or verify authenticated upstream
release metadata against a separate trust root. Apply the same check to downloads and cache hits.

Test that altered cache bytes and a checksum supplied by an untrusted source fail verification.
Keep a passing case for the pinned runtime.
