> **Completion note, November 21, 2026.** Fixed on the Acorn side.
>
> What landed:
>
> - `node-runtime.json` records a reviewed sha256 for each nodejs.org file the pin needs: the four
>   Unix tarballs and `win-x64/node.exe` for 24.21.0. The digests come from the release's
>   `SHASUMS256.txt.asc`. Its signature was checked with openpgp.js against the keys in
>   `nodejs/release-keys` on GitHub, a separate origin from nodejs.org. It was signed by Antoine du
>   Hamel's release key `20b1a390b168d356`, and its signed text matches `SHASUMS256.txt` byte for byte.
>   The pin's `//sha256` note says how to move it.
> - `apps/desktop/scripts/node-runtime.mjs` no longer downloads `SHASUMS256.txt` and no longer writes
>   a `.sha256` file beside a cache entry. The cache keeps the verified nodejs.org file itself, under
>   `~/.cache/acorn/node-runtime/v<version>/`. A download and a cache hit go through one function and
>   both must match the pinned digest. A pin with no digest for a file fails before any download.
> - The `node` binary and the LICENSE come out of a verified archive on every call. An extracted file
>   has no published digest, so a cached copy of one could not be checked independently. Extraction
>   takes about a second per stage. On Windows the verified file is the binary.
> - `cachedRuntime`, `cachedLicense`, and `stageNodeRuntime` take the parsed pin object instead of a
>   version string. `stage.mjs` and `scripts/pack-node.mjs` pass it. The packer's `BUILD` file still
>   writes `node=<version>`.
> - `docs/shell/packaging.md` describes the pinned digests.
>
> How it was checked:
>
> - `apps/desktop/scripts/node-runtime.test.mjs` has 13 cases, all passing. A download whose bytes the
>   server's own `SHASUMS256.txt` vouches for but the pin doesn't name fails, and stages and caches
>   nothing. An altered cache entry downloads again. An altered cache entry paired with a server serving
>   the same altered bytes fails, for the Windows binary and for a Unix tarball. A replaced extracted
>   binary is overwritten from the verified archive. A missing digest fails without a fetch. A real
>   `tar.gz` fixture checks that the binary and LICENSE extraction works. For every target triple and
>   for the LICENSE archive, the committed pin reaches the digest comparison, which proves it has a
>   digest for each file. The old tests fail against the new API by design.
> - The passing case for the real pin ran by hand against a new empty folder,
>   `~/.cache/acorn-d3-runtime`. The first run downloaded and verified the darwin-arm64 and linux-x64
>   tarballs, the second run verified them from the cache, and the extracted binary printed
>   `v24.21.0`. All 11 desktop script test files passed, along with oxlint and the comment-path,
>   doc-path, and doc-citation architecture tests.
> - No full `pnpm run stage` or `pnpm pack:node` ran, because the Node service size ceiling stops
>   staging on this branch. Neither ran on Windows or Linux.
>
> Decisions and deviations:
>
> - The cache holds archives, about 50 MB each, instead of only extracted binaries. A machine that
>   packs a non-Linux target also keeps the Linux x64 tarball for the LICENSE. The CI cache key is
>   `hashFiles('node-runtime.json')`, so CI starts a fresh cache entry with this change.
> - The extracted binary keeps its old cache name, so a developer cache overwrites it in place. Old
>   `.sha256` files stay behind as unused small files.
> - No pin-update script. Moving the pin is a rare, reviewed step, and a script that fetched the
>   checksums would put trust back in the download source.
> - A local user who can write to `~/.cache` between the digest check and extraction could still swap
>   the archive. That user can already edit the checkout, so this phase doesn't guard against it.
>
> For later phases:
>
> - Anyone moving the Node pin must update every digest in the same commit. The tests fail when a
>   target has no digest, and a wrong digest fails closed on the first download.
> - `docs/future/node-tray/04-platform-archives.md` still describes the old `SHASUMS256.txt` check. It's
>   a design doc for shipped work and wasn't edited.

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
