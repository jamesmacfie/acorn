# Permission lines become records, not copy

**Strength: Strong.** Small diff, and the failure mode degrades a security prompt.

## The problem, plainly

When a plugin is installed or updated, the trust dialog shows the owner a list of permission lines
— "Read your projects", "Open external URLs", and so on — and, on an update, marks which lines are
*newly requested* since the version they already accepted.

Under the hood, those lines are plain strings. Six transformer functions in
`packages/client-core/src/plugins/permissions.ts` flatten the plugin's declared grants into
`string[]`, and the dialog computes "what's new" as a set-difference over those strings
(`PluginTrustDialog.tsx:73-79`). The code knows exactly what it did — `permissions.ts:19`:

> "The update prompt's 'what is new' mark is set-difference over these strings, so the WORDING is
> the diff key — rephrasing a line without changing the grant would light it up as newly requested."

In other words: **the user-facing copy is the data key.** The sentence a human reads and the
identifier the diff algorithm compares are the same string.

It gets one step worse. Each line also needs an icon and a severity ("is this a high-risk grant?")
for rendering. That information *exists* at the source — the grant tables in `frames/scopes.ts`,
`permissions.ts`, and `frames/channels.ts` all know how serious each grant is — but the flatten to
`string[]` throws it away. So `permissionLineStyle()` (`permissions.ts:108-113`) reconstructs it by
prefix-matching the copy against a 20-entry `LINE_STYLES` table of `startsWith` rules, with one
extra escape hatch that literally sniffs `text.includes('does not recognise')`. Data is destroyed
by a transform and then re-derived from prose, in the same module.

## How it surfaces

Two stories, both cheap to trigger:

1. **The false alarm.** Someone improves the copy — "Read your projects" becomes "See your
   projects". Purely editorial; the grant is identical. On the next plugin update, the
   set-difference sees a string that wasn't in the accepted set, and every owner of every installed
   plugin gets a trust prompt claiming the plugin *asks for more* — highlighted as a new
   permission. The dialog is wrong, in the alarming direction. Owners who see enough false "asks
   for more" learn to click through it, which is precisely the reflex a trust prompt exists to
   prevent.

2. **The silently mis-styled grant.** Someone adds a new high-risk grant whose line doesn't start
   with any of the 20 known prefixes. Nothing fails — `permissionLineStyle` falls through to its
   default: a generic shield icon, `high: false`. A dangerous permission renders looking exactly as
   boring as "show a toast". No test catches it, because the styling rule is keyed to prose nobody
   told the test about.

The module even documents why it was built this way (`permissions.ts:80-82`): keying off the copy
avoided "threading a second value out of every describe\* function in three files." That was the
cheap choice at the time; this plan is the thread.

## The plan

1. **Define the record.** One small type, near the transformers:

   ```ts
   type PermissionLine = {
     key: string    // stable grant identifier, e.g. 'core.projects:read'
     text: string   // the human sentence — free to change at any time
     icon: string
     high: boolean
   }
   ```

2. **The three description tables return records.** `SCOPE_DESCRIPTIONS` (`scopes.ts:203-210`),
   `NODE_CORE_DESCRIPTIONS` (`permissions.ts:22-33`), and `CHANNEL_DESCRIPTIONS`
   (`channels.ts:14-19`) stay exactly where they are — they already hold the icon and severity
   knowledge; they just stop discarding it.

3. **The six transformers return `PermissionLine[]`** instead of `string[]`.

4. **The dialog diffs on `key` and renders `text`.** The set-difference in
   `PluginTrustDialog.tsx:73-79` compares grant identifiers. Copy edits stop being diff events.

5. **Delete the reconstruction layer.** `LINE_STYLES`, `permissionLineStyle()`, and the
   `includes('does not recognise')` sniff all go — the record carries what they were re-deriving.

6. **No stored-data migration needed** — and this is worth checking, then relying on: the desktop
   trust store persists the plugin's raw *permissions block*, not the rendered lines. Both sides of
   the diff are re-derived from grants at render time, so changing the line representation touches
   nothing on disk.

7. **Test the diff on records.** "Same grants, different wording → nothing marked new" is a
   one-line test that was impossible to even state before.

## What gets better

- Editing the trust prompt's language becomes safe — a copywriting change, not a security event.
- Severity travels with the grant from its source instead of being guessed back from prose.
- The dialog's "what's new" logic becomes directly testable with plain objects.
- Twenty prefix rules and a substring sniff get deleted.

## Files

- `packages/client-core/src/plugins/permissions.ts` — the six transformers, `LINE_STYLES` deleted
- `packages/client-core/src/plugins/frames/scopes.ts:203-210` — descriptions return records
- `packages/client-core/src/plugins/frames/channels.ts:14-19` — same
- `packages/client-core/src/plugins/PluginTrustDialog.tsx:51-89` — diff on `key`, render `text`
- `packages/client-core/src/plugins/permissionLines.test.ts` — gains the wording-change test
