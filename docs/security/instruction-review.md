# Instruction file checks and review

Some characters draw as nothing in an editor or a diff: zero-width and direction characters, the soft
hyphen, fillers, variation selectors, and Unicode tag characters. A line in `CLAUDE.md`, `AGENTS.md`,
or a skill can carry instructions that nobody reviewing it saw, and a harness reads those files
itself, with no tool call for a hook to see.

**Check instruction files before each agent turn** and **Review changed instruction files** are
separate, off-by-default settings under Settings > Security and backup. The agents runtime applies
both immediately before it sends any queued turn to a driver. A failure to scan a required input
stops that turn as incomplete and tells you to retry or change the setting. Optional plugin
`agents:before-send` hooks keep their established failure behavior.

The hidden-character check finds Unicode `Default_Ignorable_Code_Point` characters outside real
emoji sequences and names their file and line. The review compares exact byte hashes and canonical
path identities with an approved snapshot. Unapproved files require a baseline review. Findings for the
baseline or changed files identify commands, domains, sensitive paths, permission language, override
phrases, and hidden characters. They are advisory: security documentation can mention these subjects
without instructing misuse. File cards group highlights with their file and line, put files with
highlights first, and keep text previews collapsed. **What was checked** holds scan coverage and
limits. Acorn redacts credential-shaped spans from displayed text. Approval checks the discovered bytes again and
returns a conflict when they changed. The next turn checks again, even after approval.

Enabling **Review changed instruction files** opens the selected task's review automatically. Settings
prefers the task open in the workspace; choose another task to check its worktree. Opening Settings
with review enabled also checks that task, so a blocked turn's **Review instructions** action leads
directly to its review. After approval, send the blocked message again. No turn is retried automatically.
If there are no tasks, create one on that Node before reviewing its instructions.

When the exact discovered snapshot matches a readable approval on the Node, the panel shows
**Instructions already approved**, with no approval button or scan details. Projects with the same
shared skills and no additional instructions reuse that approval. Matching includes canonical file
paths, byte hashes, scan coverage, and analyzer version; copied files at different paths do not match.
An empty scan needs no approval. Acorn still discovers files before each turn to detect additions or
changes. These reads create no pending snapshot. A change to review coverage still requires approval
for discovered files even if their text is unchanged. Runtime refusals
use distinct instruction-review, incomplete-scan, and hidden-character error codes; saved dispatch
failures with the older instruction messages retain their Settings link.

The scan covers root and nested `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, and
`CLAUDE.local.md`, including `.claude/CLAUDE.md`. It follows Claude `@path` imports up to five hops.
It includes repository `.claude/skills`, `.agents/skills`, and `.codex/skills`, their supporting
scripts, and delivered plugin skills. The installed Codex 0.159.2 prefers `AGENTS.override.md` in a
directory; the review includes both spellings so a later removal also appears. The installed Claude
Code 2.1.294 reads nested Claude files when it works in their folders. The scan includes them before
the harness reaches them.

The scan has explicit bounds and failure behavior:

- It follows linked skill folders, deduplicates canonical directory walks and file reads, and
  binds each discovered alias to approval. Import or link cycles stop the scan. Missing optional
  paths are allowed; present unreadable files, broken links, and special inputs stop the scan.
- A text file with damaged UTF-8 is decoded with replacement characters. A byte order mark selects
  UTF-16. An unknown skill file format receives an unsupported-analysis finding.
- One file may hold at most 1 MB. A scan may read at most 500 files, 5,000 directories, 8 MiB of
  file bytes, 20 directory levels, and five seconds. Expiry aborts the scan.
- Advisory analysis inspects the first 20,000 lines per file and reports at most 2,000 findings.
  The review marks a reached analysis limit and leaves the full file available in the project.
- Dependency and generated trees named `.git`, `.acorn`, `.turbo`, `.venv`, `venv`,
  `__pycache__`, `node_modules`, `vendor`, `.pnpm`, `.next`, `dist`, `build`, `target`, and `coverage`
  are excluded. Repository symlink directories outside explicit skill roots are not traversed.
- Folders that Git ignores are excluded too, because cloned repositories and build output there
  can exceed the directory limit. An ignored `.claude` folder is still scanned, and so is an
  ignored instruction file such as `CLAUDE.local.md` in a folder that is scanned. Claude Code still
  reads instructions in an ignored folder when it works there, so this review doesn't cover them.
  Outside a Git repository, nothing is ignored.

The switches are the `checkInstructionFiles` and `reviewChangedInstructions` fields of the
[agent defaults](../managed-agents/defaults.md). Only a device can edit them, open a review, or
approve it. The agents plugin keeps at most two encrypted snapshots per project in its own database.
Approval metadata and digests are separate from encrypted bodies. A missing key or damaged body
requires another review. Project deletion removes its snapshots. Instruction approval does not
approve [plugin skills](../managed-agents/skills.md#approval) or
[executable repository configuration](./process-and-paths.md).

These checks have limits:

- It covers turns that Acorn sends: managed chats, resumed and queued turns, workflow steps, and
  delegated agents. Text you type into a harness in a terminal does not pass Acorn's dispatcher.
- A pre-turn scan cannot intercept a file a harness loads or changes during the turn. Global
  instructions outside the discovered scope are not covered. A process with the owner's host access
  can change Acorn's on-disk approval state.
- Text that legitimately uses a zero-width joiner or non-joiner, such as Persian, is refused too.
