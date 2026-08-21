# The comment pass

Acorn's source carries **25,500 comment lines, 2.1 MB of prose, across 1,161 files**, roughly 16% of
the codebase. Very little of it is unnecessary in the "restates the code" sense. What it has is
*necessary design rationale written at three times the needed length, in a self-important register*:
shouted emphasis, em dashes, arguments with an imaginary reviewer, sentences you read twice.

Worse, a lot of it is **duplicated**. `docs/plugins.md` and `docs/ui-design.md` already state the same
decisions in better prose, so the code comment is a second copy nobody keeps in step.

This file is the whole brief. Read it and you need nothing else from the session that started the work.

## The deliverable

For every comment in the repo, one of three outcomes:

1. **The owning doc already says it** → delete the comment, leave a one-line pointer naming the doc and
   its section. This is most of the volume and where the cut comes from.
2. **Nothing says it, and it is real design rationale** → write it into the doc that should own it,
   then do (1). `docs/architecture-overview.md § Package boundaries` is the worked example: it was
   lifted wholesale out of `tools/arch/boundaries.test.ts`, which until then was the only record of
   nineteen enforced rules.
3. **It is a fact about *this code* that is non obvious** → keep it, rewritten plainly. Unit traps, invariants, "checked
   below", "read per call, not per registration", "node:sqlite refuses a second close". None of that is
   doc material and none of it should move. Keep if useful to a developer or agent. Assume
   the agent or developer has some sense, do not keep comments for comments sake. Only keep if
   actually useful.

The test for (1) versus (2): open the doc and search. Do not guess. If the doc says it, the comment is
a duplicate however well written.

## The style, for anything that stays

Read through the `/readable` skill and use that.

Plain English, said the way you would say it to a colleague at your desk. The house rules, which are
the Google developer documentation style guide plus an anti-slop pass:

- No em dashes. Use a period or a comma. If a thought needs separating, end the sentence.
- No SHOUTED emphasis. `DELIBERATE`, `NOT`, `THE ONE`, `NEVER` in caps all become ordinary words.
- Active voice, present tense, name the actor.
- Cut the argument, keep the fact. "Rejecting `/` and `..` here keeps hostile paths away from the
  loader's confinement check" beats a paragraph on why a hostile path is bad.
- No "deliberately", "on purpose", "and that is the point", "which is the whole reason". If the code
  needs a comment to insist it was intentional, say what it does instead.
- One idea per paragraph. Past five or six sentences, split or cut.
- Keep the numbers and the file references. `7.93 MiB against an 8.00 MiB cap` is why anyone believes
  the sentence.

Before and after, from `pluginContract.ts`:

```
// A relative entrypoint. Absolute paths and `..` escapes are rejected here so the loader's
// confinement check never has to reason about a path that was hostile from the start.
```
```
// Relative only. Rejecting `/` and `..` here keeps hostile paths away from the loader's
// confinement check.
```

## Which doc owns what

| Subject | Doc |
| --- | --- |
| Manifest shape, contributions, frames, descriptors, trust, the dev loop, task checks | `docs/plugins.md` |
| Why the plugin system is shaped this way, before widening a seam | `docs/extensibility.md` |
| Package boundaries, process ownership, runtime topology, fleet semantics | `docs/architecture-overview.md` |
| Permissions, secrets, audit, the declared/enforced line, install-from-folder | `docs/security.md` |
| Collections, panels, views, trends, the mapping layer, placements, persistence | `docs/dashboards.md` |
| Icons, brand marks, plugin themes, appearance axes, primitives | `docs/ui-design.md` |
| SQLite ownership, plugin DBs, migrations, backup | `docs/data-layer.md` |
| Routes, versioning, pairing, idempotency, streams | `docs/api-reference.md` |
| Workspaces, projects, tasks, worktrees | `docs/workspaces-and-tasks.md` |
| Panes, layout, pane scope, the reference panel | `docs/panes.md` |
| Periodic work, cadence, targets, risk tiers | `docs/schedules.md` |
| Notes, memory, context assembly | `docs/notes-and-memory.md` |
| PTYs, tmux, agent state, sessions | `docs/terminal-and-agents.md` |
| Connections, providers, GitHub/Linear/Rollbar/model providers | `docs/integrations.md` |
| Query cache, TTLs, persisted IndexedDB | `docs/caching.md` |
| Why Monaco cannot live in a frame, host-owned document surfaces | `docs/third-party/monaco.md` |
| Loaded-plugin migration findings, cross-plugin references | `docs/third-party/README.md` |

`docs/future/` holds only what is **not built**. Never point live code at a file in there unless the
comment says "git history". The retired specs were deleted on purpose and their behaviour moved into
the docs above.

Work through docs/future/comments/groups.md

A file is unconverted if its comments still carry em dashes or shouted emphasis:

```bash
python3 - <<'PY'
import io, re, subprocess
COMMENT = re.compile(r'^\s*(//|/\*|\*)')
EMDASH  = re.compile(r'—')
SHOUT   = re.compile(r'(?<![A-Z0-9_])[A-Z]{3,}(?![A-Z0-9_])')
SKIP = {'GET','PUT','POST','HTTP','HTTPS','JSON','SQL','URL','URI','API','CSS','DOM','SVG','TTL','WAL',
        'PTY','IPC','MCP','LSP','UUID','CLI','ESM','CSP','SPA','ID','IDs','OS','UI','WS','PR','PRs',
        'DB','FTS','CDP','ARIA','PATH','DNS','SSRF','CA','TLS','SAN','CN','RFC','KiB','MiB','GB','MB',
        'KB','XDG','ANSI','UTF','EOF','PID','SHA','LRU','RPC','JSX','TSX','CVD','NOT','AND','OR','THE'}
rows = []
for p in subprocess.run(['git','ls-files','*.ts','*.tsx','*.css'],
                        capture_output=True, text=True).stdout.split():
    try: lines = io.open(p, encoding='utf-8').read().split('\n')
    except OSError: continue
    c = [t for t in lines if COMMENT.match(t)]
    if not c: continue
    text = '\n'.join(c)
    marks = len(EMDASH.findall(text)) + len([w for w in SHOUT.findall(text) if w not in SKIP])
    if marks: rows.append((marks, len(c), p))
rows.sort(reverse=True)
print('%d files, %d marks' % (len(rows), sum(r[0] for r in rows)))
for m, n, p in rows[:40]: print('%4d marks %4d lines  %s' % (m, n, p))
PY
```

At the time of writing: **831 files, 6,100 marks.** Work top-down: the density ranking is a good proxy for
how much prose is in there. The current top of the list is `dashboards-core/src/chart.ts`,
`client-core/src/registries/contentLinks.ts`, `client-core/src/dashboards/PanelGrid.tsx`,
`protocol/src/collections.ts`, `apps/node/test/integration/pluginDisable.test.ts`.

### The 84 files that need care

These are heavy files (25+ comment lines) whose comments cite **no doc at all**, so the code may be the
only record. They need outcome (2): read it, decide which doc should own it, write the section, then cut.

```bash
python3 - <<'PY'
import io, re, subprocess
COMMENT = re.compile(r'^\s*(//|/\*|\*)')
rows = []
for p in subprocess.run(['git','ls-files','*.ts','*.tsx','*.css'],
                        capture_output=True, text=True).stdout.split():
    try: lines = io.open(p, encoding='utf-8').read().split('\n')
    except OSError: continue
    c = [t for t in lines if COMMENT.match(t)]
    if len(c) < 25: continue
    if re.search(r'docs/[A-Za-z0-9_./-]+\.md', '\n'.join(c)): continue
    rows.append((len(c), p))
rows.sort(reverse=True)
print('%d files where the code may be the only record' % len(rows))
for n, p in rows: print('%4d lines  %s' % (n, p))
PY
```

At the time of writing, 84 files. The top of it: `apps/node/test/integration/pluginDisable.test.ts`,
`client-core/src/styles/primitives.css`, `client-core/src/dashboards/dashboards.css`,
`apps/desktop/src/app/main/electron.ts`, `apps/desktop/src/app/main/previewTunnel.ts`,
`client-core/src/styles/cssHygiene.test.ts`, `node-core/src/testkit/pluginContext.ts`,
`client-core/src/plugins/contributions.ts`.

Do not delete rationale from one of these without first putting it somewhere. That is the point of the
whole exercise: the knowledge survives the file.

## The tooling

Two scripts. Put them anywhere outside the repo (a scratch directory). They are not part of the build.

**`showc.py`** prints a file's comment blocks with the line of code each one sits above, so you can see
what a block is actually about before rewriting it.

```python
#!/usr/bin/env python3
"""Print each file's comment blocks, with the code line that follows."""
import sys, io, re
COMMENT = re.compile(r'^\s*(//|/\*|\*)')
for path in sys.argv[1:]:
    lines = io.open(path, encoding='utf-8').read().split('\n')
    print('=== ' + path)
    i = 0
    while i < len(lines):
        if COMMENT.match(lines[i]):
            j = i
            # A block comment OPENED on this line: continuation lines need not start with * or //.
            # Only when the line's first non-space is /*, and never past a bounded lookahead.
            if lines[i].lstrip().startswith('/*') and '*/' not in lines[i].split('/*', 1)[1]:
                limit = min(len(lines) - 1, i + 60)
                while j < limit and '*/' not in lines[j]:
                    j += 1
            while j + 1 < len(lines) and COMMENT.match(lines[j + 1]):
                j += 1
            k = j + 1
            while k < len(lines) and not lines[k].strip():
                k += 1
            print('--- [%d] before: %s' % (i + 1, lines[k].strip()[:80] if k < len(lines) else ''))
            for t in lines[i:j + 1]:
                print(t)
            i = j + 1
        else:
            i += 1
```

**`cedit.py`** replaces whole comment blocks, located by a unique substring of the block's first line.
Anchors beat line numbers: line numbers drift the moment you make one edit, and this is the bug that
cost the first session an hour.

```python
#!/usr/bin/env python3
"""Replace or delete whole comment blocks across many files in one pass.

stdin:
  FILE <path>
  @@ <unique substring of the block's first line>      (or @@N for the Nth match)
  <replacement lines; omit entirely to DELETE the block>
  @@ <next anchor>
  FILE <next path>
"""
import sys, io, re

COMMENT = re.compile(r'^\s*(//|/\*|\*)')
files, cur_file, cur = [], None, None
for line in sys.stdin.read().split('\n'):
    if line.startswith('FILE '):
        cur_file = (line[5:].strip(), []); files.append(cur_file); cur = None; continue
    m = re.match(r'^@@(\d*) (.*)$', line)
    if m:
        cur = [m.group(2), int(m.group(1) or 0), []]; cur_file[1].append(cur); continue
    if cur is not None:
        cur[2].append(line)

errors = []
for path, blocks in files:
    try: lines = io.open(path, encoding='utf-8').read().split('\n')
    except OSError as e:
        errors.append('OPEN %s: %s' % (path, e)); continue
    ok = 0
    for anchor, nth, body in blocks:
        hits = [i for i, t in enumerate(lines) if anchor in t and COMMENT.match(t)]
        if nth:
            if len(hits) < nth:
                errors.append('ANCHOR %s :: %s wanted #%d of %d' % (path, anchor[:60], nth, len(hits)))
                continue
            i = hits[nth - 1]
        elif len(hits) != 1:
            errors.append('ANCHOR %s :: %s -> %d hits' % (path, anchor[:60], len(hits)))
            continue
        else:
            i = hits[0]
        j = i
        if lines[i].lstrip().startswith('/*') and '*/' not in lines[i].split('/*', 1)[1]:
            limit = min(len(lines) - 1, i + 60)
            while j < limit and '*/' not in lines[j]:
                j += 1
        while j + 1 < len(lines) and COMMENT.match(lines[j + 1]):
            j += 1
        # Hard guard: a block is comment and blank lines only. Anything else means the walk
        # overran, so refuse rather than delete code.
        bad = [t for t in lines[i:j + 1] if t.strip() and not COMMENT.match(t)]
        if bad:
            errors.append('OVERRAN %s :: %s -> would delete code: %s' % (path, anchor[:50], bad[0][:60]))
            continue
        b = list(body)
        while b and b[-1] == '':
            b.pop()
        if not b:
            k = j + 1
            if k < len(lines) and lines[k].strip() == '' and i > 0 and lines[i - 1].strip() == '':
                j = k
        lines[i:j + 1] = b
        ok += 1
    io.open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print('ok  %s (%d/%d)' % (path, ok, len(blocks)))
for e in errors:
    print(e)
```

Usage:

```bash
python3 showc.py packages/foo/src/bar.ts
python3 cedit.py <<'EOF'
FILE packages/foo/src/bar.ts
@@ The first few words of the block you are replacing
// The replacement, as many lines as you need.
@@ A block you want gone entirely
EOF
```

### The trap that ate 777 lines

The first version of the block walker extended a comment block whenever the line *contained* `/*`, to
handle CSS block comments whose continuation lines start with neither `//` nor `*`. A `//` comment that
merely *mentions* `/*` then sent it hunting forward for the next `*/`, hundreds of lines away, and it
deleted everything in between. `boundaries.test.ts` went from 999 lines to 222.

Both fixes are already in the scripts above and both matter:

1. Only extend when the line's first non-space characters are `/*`, and never past a 60-line lookahead.
2. **The hard guard**: before writing, refuse any block that contains a line which is neither a comment
   nor blank. This is the one that would have caught it, and it is why the code cannot be damaged now.

## Verification, every time

Non-negotiable, because a comment pass that breaks the build is worse than no comment pass:

```bash
pnpm lint                                  # oxlint + tsc --noEmit in all 26 packages
cd tools/arch && pnpm test                 # 30 arch rules; the comment pass touches this file
```

And per file, the check that actually proves you only touched comments, with code lines
identical to the last commit:

```bash
diff <(git show HEAD:"$F" | grep -vE '^\s*(//|/\*|\*|$)') \
     <(grep -vE '^\s*(//|/\*|\*|$)' "$F") && echo "comments only"
```

CSS files show false positives there, because a block comment's continuation lines match neither
pattern. For those, check `/*` and `*/` counts balance instead.

Before finishing, re-run the dangling-doc audit:

```bash
python3 - <<'PY'
import io, re, subprocess, os
bad = []
for p in subprocess.run(['git','ls-files','*.ts','*.tsx','*.css','*.md'],
                        capture_output=True, text=True).stdout.split():
    if p.startswith('docs/future/'): continue
    try: t = io.open(p, encoding='utf-8').read()
    except OSError: continue
    for m in set(re.findall(r'docs/[A-Za-z0-9_./-]+\.md', t)):
        if os.path.isfile(m): continue
        # A retired doc named as "git history" is correct and stays. Anything else is dangling.
        for before, after in zip(t.split(m)[:-1], t.split(m)[1:]):
            if 'git history' not in before[-140:] + after[:140]:
                bad.append((p, m))
for p, m in sorted(set(bad)): print('DANGLING', p, m)
print('audit done -- anything listed above must resolve or say "git history"')
PY
```

Anything it prints must either be made to resolve or be reworded to say "git history".

## Known pre-existing test failures

Not yours. Do not chase them.

- `plugins/http`: `send.test.ts > resolveVars, command execution context` fails on `main` with the tree
  clean.
- `pnpm test` at the root cancels sibling packages when one fails. Use
  `turbo run test --continue`, then re-run any red package on its own.

## How to work

1. Generate the worklist. Take the top 10 to 20 files.
2. `showc.py` them in one call.
3. For each block, decide (1), (2) or (3) above. Search the owning doc before deleting anything.
4. Where a doc needs a new section, write it first, in that doc's voice, then cut the code comment.
5. One `cedit.py` call for the batch.
6. Verify. Commit in batches of roughly 20 files, so a bad edit is easy to find and revert.

Two calls per batch of a dozen files is the sustainable rate. Do not try to do the repo in one pass.
