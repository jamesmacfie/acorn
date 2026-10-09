# Secret checks before publication

Acorn checks for credential-shaped text before four operations it owns: a commit, a push, a
transcript export, and an agent message that carries attachments. This page covers the detector, the
optional gate, what each check reads, and what it leaves out. Read it before you change one of those
operations or add another Acorn-owned upload.

Logging redaction does not remove a token from Git history or an exported file. These checks run at
the operation that publishes the bytes, against the bytes that operation consumes.

## Detector

`packages/node-core/src/server/secretChecks/detector.ts` owns the rules. Plugins import it through
`@acorn/plugin-api/node` as `scanSecretText`, `redactSecretText`, `decodeSecretInput`, and
`secretReport`. The detector runs on the node with no network call, no token validation, and no model.
`SECRET_DETECTOR_VERSION` is `acorn-secrets/1`. Raise it whenever a rule changes, because allowances
and the Git blob cache bind to it.

The rules come in two tiers:

| Tier | Rules | Effect with blocking on |
| --- | --- | --- |
| High confidence | Private key headers, AWS access key IDs, GitHub, GitLab, Slack, Stripe live, Anthropic, OpenAI, Google API, and npm tokens, and Slack webhooks | Blocks |
| Heuristic | JWTs, URL passwords, and `key = "value"` assignments with at least 3.5 bits of entropy per character | Warns |

A match is a likely secret, not a confirmed live credential. Narrow content rules skip documented
placeholders: AWS's `EXAMPLE` keys, runs of eight identical characters, `${…}` and `{{…}}` slots, and
values that start with `your` or `my`. No directory is excluded, so test fixtures are checked too.
Where two rules match the same text, the earlier, more specific rule names it.

A report names the detector version, the rule, the location, and the line and column. It never holds
the matched value or the line around it. It keeps at most 200 findings, high-confidence first, and
`counts` stays exact past that limit. The redacted export replaces each match with
`[redacted secret]`.

Acorn uses its own table instead of Gitleaks or secretlint. Gitleaks ships as a Go binary, so Acorn
would need a signed sidecar for each platform. secretlint 13.0.7 missed a bare AWS key ID and a key
header in the fixtures, has no confidence tiers, and puts the matched value in every message. Each
rule has a fixture in `detector.test.ts`. The fixtures are assembled at runtime, so no token literal
sits in the repository.

## Policy

**Check for secrets** in Changes works whether blocking is on or off. It reports and never admits.

**Block publication with secret findings** is one setting per node, off by default, under Settings >
Security and backup. It lives in the `security.secretPublication.block` core preference. Only a
device can change it, through `/v1/core/security/secret-publication`, which sits under core's
device-only `/security` mount. While it is off, commit, push, export, and send run exactly as they did
before, with no check.

With blocking on, `ctx.core.secretPublication.admit` decides each operation:

- A high-confidence finding blocks.
- An incomplete check blocks: an unscanned input, an exceeded limit, a timeout, or a Git failure.
- Heuristic findings alone pass.

A refusal records a decision in core, in memory, for ten minutes. The decision binds the operation,
its destination, the content digest, and the detector version. The device allows it once through
`POST /v1/core/security/secret-publication/allow`. The next matching attempt spends the allowance.
Changed content, a different destination or operation, a new detector version, or expiry each
needs another decision. Core keeps at most 50 decisions. A restart forgets them, which only asks
the owner again.

Task, service, and plugin-frame callers get 403 from every verb on that route. `secretPublication` is
a compiled-core facet only: `scopeCore` gives a loaded plugin no grant for it, and the facet has no
method that allows an exception. An allowance does not bypass other vetoes. The Changes
`before-commit` and `before-push` hooks run first and keep their contracts.

## Git

`plugins/changes/src/server/secretCheck.ts` selects what each Git operation publishes. It reads Git
objects, never the disk, and loads only while blocking is on or when you press a check button.

A commit check reads the blobs the next commit adds over its parent. The parent is HEAD, or HEAD's
parent for an amend, so an amend covers the whole final tree. Without `-a`, the tree is the index from
`git write-tree`. With `-a`, Acorn copies the index file, runs `git add -u` against the copy, and reads
that tree. The real index is untouched. The digest binds the tree, the parent, the branch, and every
commit option.

Acorn serializes its own stage, unstage, discard, and commit calls per worktree. Before the commit,
it reads the tree again and refuses if it moved. After the commit, it compares the tree Git recorded
with the tree it checked. A native pre-commit hook can restage files, so a different tree gets a full
check. If that check is refused, Acorn moves the branch back with `git update-ref HEAD <before>
<after>`, which only succeeds while the branch still points at the commit Acorn made. The index keeps
the hook's changes, and the next attempt checks the same tree. Owner hooks keep running.

A push check asks the remote for its refs with `git ls-remote origin`. Stale local tracking refs
don't count. Every advertised object that this clone has bounds a `git rev-list --objects` walk from
HEAD. The check reads every blob the walk names, including a secret a later commit deleted. A new
branch, or a remote with no matching branch, checks everything no other remote ref reaches. Force
pushes keep `--force-with-lease`. With `push.followTags` set, Git also sends annotated tags that
point into HEAD's history and that the remote lacks. Their commits are already in the walk, so the
check scans each tag's message and binds the tag IDs, up to 200 tags. A missing remote, a detached
HEAD, or a failed `ls-remote` makes the check incomplete. Before the push, Acorn rereads HEAD and
refuses if it moved.

The Git checks have these bounds:

- A text blob may hold 8 MiB. A larger one is unscanned.
- One check reads at most 20,000 blobs and 64 MiB.
- Blobs with a NUL byte in their first 8,000 bytes are binary. The report counts them in its limits,
  and they don't make the check incomplete.
- Results are cached by blob ID and detector version, with positions and rule IDs only. The cache
  holds up to 20,000 blobs.

A Git process outside Acorn can still change the index or move HEAD between the last check and the
command. Git has no transaction that covers both, so Acorn narrows the window and doesn't close it.

## Agents

`plugins/agents/src/server/sessions/secretPublication.ts` checks the two agent operations.

An export checks the exact serialized string the route returns, up to 64 MiB. A larger export is
unscanned. The digest leaves out `exportedAt`, so an allowance survives the re-export that follows
it. **Export Markdown without secrets** and **Export JSON without secrets** in the session menu return
a separate redacted copy. JSON is redacted string by string, so the copy stays valid JSON. The stored
session never changes. The route's `variant` field names which copy it returned.

An agent message with attachments is checked at the shared dispatch point, after the instruction
check and immediately before the driver send. That point covers every turn source: interactive,
workflow, delegated, resumed, and retried turns. The check reads each attachment's stored bytes and
binds them by ID and SHA-256 digest. `text/*` attachments are decoded as strict UTF-8 and scanned.
Images, PDFs, and other formats are reported unscanned, so with blocking on a turn that carries one
needs an allowance. A refused turn fails with the reason. After you allow it, use **Retry**.

The attachment check does not read the message text. Uploading an attachment is not publication, so
the upload route doesn't check it.

## Audit

A refusal writes `secrets.publication.blocked` and an allowance writes `secrets.publication.allowed`.
Their details hold the decision, the counts, the rule IDs, and the decision ID. Remote URLs lose their
user and token before core stores or shows a destination. No report, error, log, audit row, or cache
entry holds a matched value.

## Coverage and limits

The checks cover Acorn's Changes commit and push, the agent transcript export, and agent messages with
attachments. Any other Acorn-owned upload or share action needs its own admission point and a line in
this list.

These paths stay outside coverage:

- Git, curl, or uploads run in a terminal or by an agent's own tools.
- Other MCP servers, browser form uploads, filesystem copies, and other apps.
- Files an agent reads itself during a turn, and the text of a message.
- Provider-generated artifacts, until an Acorn-owned action publishes them.

A finding does not revoke anything. If a credential may have left the machine, rotate it with its
provider. Acorn does not change provider accounts.
