import { relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

// Top-level imports in main are awaited before rendering. Imports inside functions are optional or
// post-frame work. Read the parsed module so minification and a module reached by both static and
// dynamic imports cannot hide a startup dependency.
export function startupGraph(): Plugin {
  const repo = resolve(import.meta.dirname, '../..')
  const entry = resolve(import.meta.dirname, 'src/main.tsx')
  return {
    name: 'acorn:tui-startup-graph',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const code = this.getModuleInfo(entry)?.code
      if (!code) throw new Error('Cannot read the terminal startup entry.')
      const imports = new Set<string>()
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) { for (const child of node) visit(child); return }
        const fields = node as Record<string, unknown>
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(String(fields.type))) return
        if (fields.type === 'ImportExpression') {
          const source = fields.source as { value?: unknown }
          if (typeof source?.value !== 'string') throw new Error('Startup imports must name a literal module.')
          imports.add(source.value)
        }
        for (const child of Object.values(fields)) visit(child)
      }
      visit(this.parse(code))

      const moduleChunks = new Map<string, string>()
      const chunks: Record<string, { imports: string[]; dynamicImports: string[]; modules: string[] }> = {}
      let entryFile: string | undefined
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        if (output.facadeModuleId === entry) entryFile = output.fileName
        for (const id of Object.keys(output.modules)) moduleChunks.set(id, output.fileName)
        chunks[output.fileName] = {
          imports: output.imports,
          dynamicImports: output.dynamicImports,
          modules: Object.keys(output.modules).map((id) => relative(repo, id.replace(/\?.*$/, ''))),
        }
      }
      if (!entryFile) throw new Error('Cannot find the terminal startup entry chunk.')
      const roots = new Set([entryFile])
      for (const source of imports) {
        const resolved = await this.resolve(source, entry)
        const chunk = resolved && moduleChunks.get(resolved.id)
        if (!chunk) throw new Error(`Cannot find startup import '${source}' in the terminal bundle.`)
        roots.add(chunk)
      }
      this.emitFile({ type: 'asset', fileName: 'startup-graph.json', source: JSON.stringify({ entry: entryFile, roots: [...roots], chunks }) })
    },
  }
}
