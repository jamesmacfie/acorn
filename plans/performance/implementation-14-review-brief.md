# Unit 14 coordinator review brief

Source review on October 1, 2026. Read report 11 and preceding reviewed ownership changes. Start only
after preceding units pass coordinator review. Preserve shipped status sharing, fresh refusal reads,
content keys, four-worker sweeps, and the Node/plugin filesystem boundary.

## HEAD observations

`computeTaskStatuses` authorizes and excludes archiving tasks before Git work. Admit an observation
generation per task before the status await, and publish HEAD only from that task's matching newest
generation. A global sweep generation would suppress valid disjoint authorized rosters. Preserve
silent initial seeding, null/failed status behavior, branch fields, and the original caller's response
even when it becomes obsolete for Node notifications. Identify cleanup on task/project retirement
and data-root reset without letting a held result seed a retired observer. Do not add a headless
polling clock or reimplement the client's latest-result fence at the wrong layer.

## Filesystem stamp admission

`localStatus` already shares four Git reads but starts every unstaged stamp through Promise.all.
Replace that burst with bounded admission and preserve result order and each admitted reader's fresh
stat. Compare bounds on the 3,000-file/four-reader fixture before choosing one. Fresh mode, size,
mtime, and ctime belong in the key; ctime catches an edit that restores mtime and size. Preserve gone
deletions, unknown-key fallback, staged object keys, submodules, conflict projection, and fresh
operation marker reads. An in-flight whole-projection join needs a separate mutation/freshness
proposal and authorization before joining; it is not implied by identical cached porcelain.

## Cached stdout lifetime

The two-second Git read cache serves reads and never refusal decisions. `fresh: true` must bypass a
running read and TTL but can publish its result for subsequent readers. Already admitted older
callers can still receive their original answer. Expire retained completed stdout at the owning
cache rather than wait for another read of an abandoned path. A bounded shared clock or equivalent
owner avoids one timer per cached command. Guard expiration and finally cleanup by entry identity
so an old timer/read cannot remove a replacement after invalidation or a fresh read. Drop failed
empty entries and unused path maps appropriately. Reset and path invalidation must retire all
associated timers/entries. Keep a shared reader's request alive when another reader cancels; transport
retirement does not by itself authorize cancelling shared Git work.

## Exact Git paths and complete patches

Porcelain and numstat currently preserve C-quoted path strings, which become wrong filesystem keys
and path arguments. Trace both parsers and staged/unstaged/rename consumers. Decode byte escapes
correctly, including octal UTF-8 bytes, quoted backslashes/quotes, tabs, and newlines. JavaScript JSON
parsing alone cannot decode Git octal escapes. Alternatively propose coordinated NUL-delimited reads
at the shared owner; do not silently stop sharing core status or change only one parser. Preserve
path validation and confinement. Malformed or unsupported encodings need explicit handling rather
than guessed paths, and rename count matching must not corrupt real filenames containing arrow or
brace characters. Verify actual Git output on disposable repositories with global/system config
disabled.

The untracked --no-index path treats exit 0/1 as success but ignores `truncated`. Refuse incomplete
patch bytes through the established error contract, matching the tracked-diff policy. Preserve exact
supported patches and final lines; do not silently truncate or raise an unrelated output cap. Keep
process cancellation/deadline/environment policy at the existing core Git/process seam.

## Evidence

Capture fresh cumulative baselines and exercise actual observers, status/cache owners, real Git
parsers/diffs, and disposable filesystem fixtures. Seed HEAD A, hold old A, complete fresh B, then
release old A: one B event, no regression, no duplicate on warm follow-up. Assert bounded outstanding
stamps and exact keys/order/counts for cold, warm, and four readers; bounded workers alone do not
reduce stat count. Assert expired abandoned paths release retained stdout after GC and no late result
revives them. Cover invalidation, fresh refusal, simultaneous expiry/new read, failed reads, reset,
permission filtering, archive, edits/restored mtime/chmod/rename/conflict/submodule/delete, quoted
Unicode/control filenames, and explicit 17 MB untracked cap failure. Node CPU excludes child Git CPU;
sampled outstanding heap is not retained heap. Report counts, CPU, and memory separately.
