# File status and editing controls

The strip below the active file shows its relative path, one-based line and column, language,
indentation, selection length, and save state. Selection length sums CodeMirror ranges in UTF-16
document units, without copying selected text; multiple selections are aggregated. **Copy path**
copies the full relative path even when the visible label is clipped by the available width. **Details**
offers tree reveal, indentation choices, and a retry for ordinary save failures. The detailed error
stays in the banner. Conflict and deletion actions stay in their existing banner. Image previews show
**Read-only preview** without text position or indentation. A PTY shows **External editor** without
claiming to know its cursor or save state. The terminal client shows the file facts it has without
constructing CodeMirror state. The strip sits after the active document or preview, so its position
stays stable as the editor changes mode.

The strip derives **Saved**, **Unsaved**, **Saving…**, and **Save failed** from document custody. A
write acknowledgement for an earlier edit leaves a later edit **Unsaved**. Recovered drafts,
disk conflicts, and missing files take precedence over ordinary save states. Cursor movement changes
the strip without a live announcement; failure and conflict banners announce their text.

Graphical text starts with wrapping off. **Toggle word wrap** in the palette and **Word wrap** in
**Details** override one open tab for this session. **Wrap by default on this device** changes the
device preference for tabs without an override. The host's default chord is Cmd+Option+W and can be
rebound in Keyboard shortcuts. A CodeMirror compartment changes wrapping without changing text,
selection, undo, search state, markers, or custody. The option is unavailable for image previews and
PTYs.

On first text load, Editor samples at most 200 lines and 64 KiB. Leading runs of two, four, or eight
spaces set the width; leading tabs select tab mode. Mixed or unindented samples use two spaces.
For example, `root\n    child` selects four spaces, while `root\n  child\n\tother` falls back to
two spaces. **Details** offers explicit **Spaces: 2/4/8** and **Tabs: 2/4/8** choices. **Use this
indentation by default on this device** changes the fallback for later ambiguous files. The choice
survives pane remounts and folder rename in this session. It affects later indentation and tab
display without rewriting existing whitespace or line endings. **Indent selection** and **Outdent
selection** are palette commands; Tab remains available for keyboard navigation.

Focused graphical commands expose Find, Replace, Toggle comment, Duplicate line, Move line up and
down, Select next occurrence, Undo, and Redo. Find opens the shared
[find panel](../editor.md#find-in-a-file), and Replace opens it with the replace row showing and its
field focused. Go to line uses the file-navigation search command and records the jump in Editor
history.
Commands check the admitted file when they run, so a palette opened before a tab switch cannot edit
the former file. Read-only text allows Find and Select next occurrence; text edits and unavailable
undo or redo actions leave the palette. Graphical commands do not load CodeMirror until a text
rectangle admits a file.
