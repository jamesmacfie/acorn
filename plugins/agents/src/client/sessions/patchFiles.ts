// A file change's patch as the files it covers, each as hunks from its first `@@` on, which is the
// shape the diff rows are built from. A per-edit change is already one file's hunks
// (contract/wire.ts § file_change). Codex's whole-turn diff has no path and is a multi-file git
// patch, so it is split at each `diff --git` header and the header lines are dropped. A file with no
// hunks, such as a binary file or a mode change, keeps its entry with an empty patch, so the reader
// still sees that it changed.
export function patchFiles(path: string | undefined, patch: string): { path: string; patch: string }[] {
  if (!/^diff --git /m.test(patch)) return [{ path: path ?? '', patch }]
  return patch.split(/^diff --git /m).slice(1).map((part) => {
    // `a/<old> b/<new>`: the new side names the file as it now stands.
    const header = part.split('\n', 1)[0]
    const hunks = part.search(/^@@ /m)
    return {
      path: header.match(/ b\/(.+)$/)?.[1] ?? header,
      patch: hunks === -1 ? '' : part.slice(hunks).trimEnd(),
    }
  })
}
