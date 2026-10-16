// The modules scripts/acornUi.mjs serves.
declare module 'virtual:acorn-ui.css'
declare module 'virtual:acorn-ui/appearances' {
  type Entry = { id: string; label: string }
  /** The themes and style packs in the app's order, with its labels, and the ids of the dark themes. */
  const appearances: { themes: Entry[]; styles: Entry[]; dark: string[] }
  export default appearances
}

// The module apps/site/scripts/keybindings.mjs serves.
declare module 'virtual:acorn-keybindings' {
  /** Every default shortcut, with what it does and where it works. `to` ends a numbered run. */
  const rows: {
    chord: string
    to?: string
    description: string
    category: string
    where: string
    terminal: boolean
    desktop: boolean
  }[]
  export default rows
}

// The module apps/site/scripts/cliHelp.mjs serves.
declare module 'virtual:acorn-cli-help' {
  /** `acorn --help`, then each command's own `--help`, as the built binary prints them. */
  const help: { overview: string; commands: { command: string; text: string }[] }
  export default help
}

// starlight-llms-txt's page renderer, which astro.config.mjs aliases by file path.
declare module 'starlight-llms-txt/render' {
  import type { APIContext } from 'astro'
  import type { CollectionEntry } from 'astro:content'
  /** Renders a page and converts the HTML back to Markdown, as /llms-full.txt does. */
  export function entryToSimpleMarkdown(entry: CollectionEntry<'docs'>, context: APIContext): Promise<string>
}
