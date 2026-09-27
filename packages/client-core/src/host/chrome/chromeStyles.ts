import { styleValueProblem, STYLE_TOKEN_FAMILIES } from '@acorn/protocol/styleValues.ts'
import type { PluginStyleDescriptor } from '@acorn/protocol/plugin/contract.ts'
import type { Disposable } from '../../kit/lib/registry'
import { styleRegistry } from '../registries/shell/styles'

export const PLUGIN_STYLE_PREFIX = 'plugin:'
export const pluginStyleId = (pluginId: string, styleId: string): string => `plugin:${pluginId}:${styleId}`
const SAFE_ID = /^plugin:[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9-]{0,63}$/

export function pluginStyleBlock(id: string, descriptor: PluginStyleDescriptor): string {
  if (!SAFE_ID.test(id)) throw new Error(`style id '${id}' is not a safe selector value`)
  const declarations: string[] = []
  for (const token of Object.keys(descriptor.tokens).sort()) {
    const value = descriptor.tokens[token]
    const problem = styleValueProblem(token, value)
    if (problem) throw new Error(problem)
    declarations.push(`  ${token}: ${value};`)
  }
  return `:root[data-style="${id}"] {\n${declarations.join('\n')}\n}`
}

const blocks = new Map<string, string>()
let element: HTMLStyleElement | null = null

export const pluginStyleStyleSheet = (): string => [...blocks.values()].join('\n\n')

function flush(): void {
  if (typeof document === 'undefined') return
  if (!element) {
    element = document.createElement('style')
    element.dataset.acorn = 'plugin-styles'
    document.head.append(element)
  }
  element.textContent = pluginStyleStyleSheet()
}

export function registerPluginStyle(pluginId: string, descriptor: PluginStyleDescriptor): Disposable {
  const id = pluginStyleId(pluginId, descriptor.id)
  const css = pluginStyleBlock(id, descriptor)
  const families = [...new Set(Object.keys(descriptor.tokens).map((token) => STYLE_TOKEN_FAMILIES[token]))]
  const entry = styleRegistry.register({
    id,
    label: `${descriptor.label} (${pluginId})`,
    description: descriptor.description,
    families,
  }, pluginId)
  blocks.set(id, css)
  flush()
  return {
    dispose: () => {
      blocks.delete(id)
      flush()
      entry.dispose()
    },
  }
}
