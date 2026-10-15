// The modules scripts/acornUi.mjs serves.
declare module 'virtual:acorn-ui.css'
declare module 'virtual:acorn-ui/appearances' {
  type Entry = { id: string; label: string }
  /** The themes and style packs in the app's order, with its labels, and the ids of the dark themes. */
  const appearances: { themes: Entry[]; styles: Entry[]; dark: string[] }
  export default appearances
}
