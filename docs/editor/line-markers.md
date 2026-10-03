# Line markers

This page covers the bars the editor draws beside lines that belong to the pull request or that
aren't committed yet, and how their positions are checked against the file you see. It's part of
[editor](../editor.md).

## Line provenance markers

The graphical editor draws up to two 2px bars inside each line's left inset:

- An accent bar marks a line in the task branch's committed pull request diff, against the pull
  request's base branch.
- An add-colored bar marks a line that differs between `HEAD` and the file on disk.

A line in both sets draws both bars side by side without moving the code. A pure deletion has no line
to mark, so it draws no bar.

### Providers

The editor owns the `editor:line-markers` Node extension point and the line-range wire shape
(`plugins/editor/src/contract/lineMarkers.ts`). Changes contributes the uncommitted set, and GitHub
contributes the pull request set. The editor depends on neither: a missing provider draws no bar, and
one failing provider doesn't hide the other. Each provider returns positions in the working-tree
document, so the CodeMirror extension only draws.

GitHub takes the pull request's base ref and head SHA from its mirror, finds the local merge base,
and compares it with the mirrored head. It then moves those ranges through later local commits and
the working-tree patch. So local insertions shift later markers, and a local replacement of a pull
request line keeps both bars on its replacement. Changes compares `HEAD` with the working tree, so
its set includes staged and unstaged edits, and an untracked file counts as added.

Text opens without waiting for markers or the grammar. The pane refreshes markers after its own
save, after a focus reload, and when a cached tab comes back after more than the two-second Git status
window. A marker failure only affects the bars. The text still opens and stays editable.

### Matching the displayed text

The client hashes the clean document it shows, as SHA-256 over its UTF-8 bytes including any byte
order mark and line endings, and sends it as the `revision` parameter of the `line-markers` request.
The Node returns `{ revision, markers }` only when confined disk reads before and after the provider
work match that body, root, inode, size, modification time, and change time. A changed or unreadable
file returns `{ revision: null, markers: [] }`. The hash catches same-size edits with the modification
time restored. The change time and inode catch a write followed by a restore, and a file replaced
during the Git work. None of this locks out other writers.

The pane also checks its Node, document entry, local edit revision, and request generation before it
shows markers. A stale response keeps the bars for the text on screen. Any document change clears the
disk bars at once, including typing, a reload, and a formatter. Dirty or saving documents don't ask
for markers. A save, undoing back to the saved text, focus, or returning to a cached tab asks again.
Host document surfaces and the terminal client's external editor don't show disk markers.

A request without `revision` gets a plain array, for older clients. A newer client shows no markers
when an older Node returns that array, because it can't be checked. Providers get an optional third
argument, the editor's confined root, which first-party providers check against the root they found
themselves. No provider gains file system access or sees the displayed text. Each checked request
costs two full disk reads and hashes on the Node and one hash on the client.
