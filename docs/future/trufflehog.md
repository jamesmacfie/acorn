# TruffleHog as a loaded plugin

Date: November 11, 2026. Status: proposed. No phase started. The plugin lives in its own repository,
`../acorn-trufflehog`, not in this checkout. Before you build, recheck the CLI facts below against
`trufflehog --help` and the Node's `plugin_authoring` answer.

[TruffleHog](https://github.com/trufflesecurity/trufflehog) finds keys, tokens, and passwords in code
and its history. It also checks with the provider whether each one still works. It's a command-line
tool whose output is a stream of JSON lines. This plan puts a task pane over it: buttons that start a
scan, a list of what the scan found, and the steps a person takes after a real finding. Later phases
show findings in the diff, the editor, the push button, the archive dialog, and agent sessions.

The plugin contract belongs to [plugin authoring](../plugin-authoring.md) and the Node's
`plugin_authoring` tool. This page doesn't restate it.

## Starting point

### Other TruffleHog interfaces

Each of these reads TruffleHog's output after a scan. None of them runs the scan or follows a finding
into the code.

- [TruffleHog Explorer](https://github.com/GONZOsint/trufflehog-explorer) is one HTML page. You load
  JSON files, then filter by repository, detector, date, and verification. You mark findings real or
  false in bulk, add comments, save and reload a session, and export to CSV or JSON. Take the triage
  marks, the bulk actions, and the saved progress.
- [TruffleShow](https://github.com/alioguzhan/truffleshow) is a viewer that runs only in the browser.
  It notes that `--json` writes one object per line, not one JSON document, so users pipe it through
  `jq -s`. Its roadmap asks for ignore rules built from the findings a person picked. Take the
  line-by-line reading and the ignore rules.
- [DidILeak](https://github.com/frangelbarrera/DidILeak) scans chat exports, not code. Its report
  shows a masked value, a severity, the surrounding text, and a rotation guide on every row. Take the
  masking and the guide per finding.
- [How to Rotate](https://github.com/trufflesecurity/how-to-rotate), at howtorotate.com, holds 35
  rotation guides. TruffleHog's team names each one after a detector type, for example `aws.md` and
  `github.md`. Take a **How do I rotate this?** link whenever a guide matches the detector.

The official Chrome and Burp Suite extensions scan web traffic as it passes. That's a different job,
and this plan takes nothing from them.

### The CLI

Version 3.99.8 is the one checked, installed with `brew install trufflehog`.

Two sources fit a task first. `trufflehog filesystem PATH` scans the working tree, uncommitted files
included. `trufflehog git file://PATH` scans history. Add `--since-commit main --branch HEAD` to limit
it to the commits on the task's branch. A local git scan clones the repository to a temporary folder
before it reads it, a guard against CVE-2025-41390. Leave `--trust-local-git-config` off.

`--json` writes one finding per line, as it finds them. The fields the plugin reads:

| Field | Use |
| --- | --- |
| `DetectorName`, `DetectorType` | What kind of key it is. Matches a How to Rotate guide name. |
| `DecoderName` | `PLAIN`, `BASE64`, and so on. Shown as a detail. |
| `Verified`, `VerificationError` | Which of the three results it is. |
| `Raw`, `RawV2` | The secret itself. Hash it, then drop it. |
| `Redacted` | TruffleHog's mask. It can hold the whole value, so the plugin masks again. |
| `ExtraData` | Facts the check returned, such as an AWS account and ARN. |
| `SourceMetadata.Data.Filesystem` | `file`, `line`. |
| `SourceMetadata.Data.Git` | `file`, `line`, `commit`, `email`, `timestamp`, `repository`. |

`--sarif` writes a single document when the scan ends. That suits an export, not live progress.

The three results:

- **Verified**: the provider accepted the key, so it works right now.
- **Unknown**: the check failed, for example on a network error.
- **Unverified**: it looks like a key, and nothing confirmed it.

Flags the plugin uses or exposes: `--results`, `--no-verification`, `--include-detectors`,
`--exclude-detectors`, `--exclude-paths` (a file of regular expressions), `--exclude-globs` (git
only), `--filter-entropy`, `--concurrency`, `--no-update`, `--no-color`, and `--no-ignore-tag`.
`--fail` exits with code 183 when it finds anything. A comment containing `trufflehog:ignore` on a
line skips that line.

`trufflehog analyze` asks the provider what a key can reach, for about 20 key types. It's
interactive, so it can't run from a button until someone checks whether it takes its input without a
person. Phase 5 starts with that check.

Sources for later phases: `github --org`, `gitlab`, `docker --image`, `s3`, `gcs`, `postman`,
`jenkins`, `huggingface`, `stdin`, and `multi-scan --config`.

## After a finding

A scan is the first step. The plugin's detail view walks a person through the rest, in this order:

1. Decide whether it's real. Verified usually means yes. For the other two, read the line, then mark
   it real or **Not a secret**.
2. Rotate it before anything else. Deleting a leaked key from the code doesn't make it safe, because
   the key still works and copies of the old commit still exist.
3. Find out what the key could reach and whether anyone used it. `analyze` answers the first for
   some providers. The provider's own access logs answer the second.
4. Take the value out of the code. Move it to an environment variable or a secret store.
5. If the commit was pushed, clean the history with `git filter-repo` or BFG. The plugin shows the
   command and never runs it, because a history rewrite can destroy other people's work and can't be
   undone.
6. Stop the next one: a pre-commit hook, the TruffleHog GitHub Action, or **Scan before push** from
   Phase 3.
7. For a false positive, record why: a `trufflehog:ignore` comment, a line in the exclude-paths
   file, or the plugin's own mark.

## Design

### Shape

Copy `../acorn-runn`. It's a loaded plugin built with Vite: `src/acorn-plugin.json`, `src/node/`,
`src/client/`, and `src/shared/wire.ts`. It draws a task pane as a remote tree, asks for `exec`, and
runs its own job runner in `src/node/jobs.ts`. That runner streams a long command's output and sends
a `changed` event, so the pane reads again. A scan is a long command too. Reuse the runner, and turn
each JSON line into a row as it arrives instead of keeping it as log text.

The Node's broker hands back output only when a process ends, which is why runn spawns its own. Take
the child's environment from `proc.brokerEnv`, as runn does, so a scan sees what a brokered process
would.

### Secrets stay out of storage

The plugin never stores, logs, or shows `Raw` or `RawV2`. For each finding it keeps:

- The detector, the result, and where it was found.
- A mask the plugin makes itself: the first four characters and the length.
- A fingerprint: SHA-256 of the detector name and the raw value.

The fingerprint lets a triage mark survive the next scan, and lets the list fold the same key found
in five commits into one row. A **Copy secret** button would need a fresh scan of that one line, so
it's left out.

### Stored data

The plugin owns three tables through its `migrations/` folder: scans, findings, and marks. Marks are
keyed by project and fingerprint, not task, so **Not a secret** in one task holds in the next task on
the same repository.

### Defaults

Run every scan with `--json --no-update --no-color`. Show verified and unknown results by default,
with a switch that adds unverified ones. Verification sends each candidate key to its provider, so
the switch that turns it off (`--no-verification`) sits beside the scan buttons, not in Settings.

The manifest asks for `exec` and no `net` grant, because the scanner makes its own requests.

## Phase 1: Scan a task and list the results

Goal: a person scans a task's worktree from a button and reads what it found.

- A task pane, **TruffleHog**, with **Scan working tree** and **Scan this branch's commits**.
- Live progress and the scan's log, with **Cancel**. One scan per task at a time.
- Results grouped as verified, unknown, and unverified. Search, and a filter by detector.
- Each row shows the detector, the mask, the file and line, and the commit and author for a git
  scan. **Open file** goes to the line in Editor.
- When `trufflehog` isn't on the Node's PATH, the pane says so and shows `brew install trufflehog`.

Done when a scan of a task holding a clone of `trufflesecurity/test_keys` lists its AWS key as
verified. A search of the pane, the plugin's database file, and the Node log for the raw value finds
nothing.

## Phase 2: Triage and next steps

Goal: each finding ends in a decision, and the plugin helps carry it out.

- Marks: **Open**, **Rotated**, **Not a secret**, and **Accepted risk**, each with an optional note.
  Marks work on one row or a selection.
- The detail view holds the steps in [After a finding](#after-a-finding), filled in for the
  finding: the How to Rotate link when a guide matches, `ExtraData` as a table, and a `git
  filter-repo` command to copy.
- **Add ignore comment** writes `trufflehog:ignore` on the finding's line. **Ignore this path**
  adds a line to the repository's exclude-paths file. Both show the change before they write it.
- A finding marked **Not a secret** stays hidden in later scans until someone clears the mark.

Done when marks hold across a fresh scan, and the change from each ignore action shows in the task's
diff.

## Phase 3: Findings where people already look

Goal: nobody has to open the pane to learn a task has a live key in it.

- Diff line marks through `git:diff-line` and `github:diff-line`.
- Editor marks through `editor:file` and `editor:line`.
- A danger dot on the pane through `core:pane` while any verified finding is open.
- **Scan before push** through `git:push-actions`. It scans only the commits not yet pushed.
- An archive check through `taskChecks` that warns about open verified findings. It only warns. See
  [task checks](../plugins/task-checks.md) for the two-second deadline it must meet.

Done when the Phase 1 key shows in each place, and archiving the task warns about it.

## Phase 4: Agents

Goal: an agent working in the task can ask about secrets without ever seeing one.

- An agent tool, `trufflehog_findings`, that returns the task's masked findings.
- An agent tool, `trufflehog_scan`, that starts a scan and returns its results. It must finish
  inside the 30-second tool limit, so it runs the working tree scan only, and returns a partial
  answer with a note when it runs out of time.
- A task context section through `contextSections` that lists open findings, masked.
- Optional: **Fix with an agent** on a finding, starting a session with a drafted prompt. Check
  first. `AGENT_SESSION_STARTER` is a key core reads, and nothing shows a loaded plugin can start a
  session with a draft. If it can't, leave the button out rather than ask for a new contract here.

Done when an agent asked "are there secrets in this branch?" answers from the tool, and its
transcript holds no raw value.

## Phase 5: Beyond one task

Goal: the same view across every project on the Node, on a schedule.

- Check whether `trufflehog analyze` can run with no person typing. Add **What can this key reach?**
  only if it can.
- A Node-wide view in `core:security` that counts open findings by project.
- Recurring scans through `schedules`, which allows four. A new verified finding raises an alert.
- Scans of a GitHub organization, a Docker image, and an S3 bucket, with their tokens in the
  plugin's secrets.
- Export to SARIF, CSV, or JSON.

Done when a nightly scan finds a key added during the day and raises it as an alert.

## Left out on purpose

- Running a history rewrite for the person.
- Revoking or rotating keys for them through the provider's API.
- Keeping the raw value anywhere, for any feature.
- A built-in scanner. The plugin needs `trufflehog` installed, and says so.
