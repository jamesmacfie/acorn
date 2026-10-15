// The modules scripts/acornUi.mjs serves.
declare module 'virtual:acorn-ui.css'
declare module 'virtual:acorn-ui/appearances' {
  const appearances: { themes: string[]; styles: string[] }
  export default appearances
}
