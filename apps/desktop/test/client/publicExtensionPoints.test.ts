import { expect, it } from 'vitest'
import { PUBLIC_EXTENSION_POINTS } from '@acorn/protocol/publicExtensionPoints.ts'
import { extensionPointRegistry } from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints'
// Core registers its own points beside the code that draws them, so import each of those modules.
import '@acorn/client-core/host/linkPreview/linkPreview.ts'
import '@acorn/client-core/host/markdownFences/fenceViewers.ts'
import '@acorn/client-core/host/annotations/taskAnnotations.ts'
import '@acorn/client-core/host/annotations/statusAnnotations.ts'
import '@acorn/client-core/features/settings/StorageSettings.tsx'
import '@acorn/client-core/features/settings/SecuritySettings.tsx'
import '@acorn/client-core/features/settings/plugins/PluginsSettings.tsx'
import { clientPlugins } from '../../src/client/plugins'

// The node can't read this registry, so `plugin_authoring` lists points from the protocol catalogue
// (docs/agent-tools/plugin-tools.md § plugin_authoring). This holds the two together: every point
// registered in code is listed, with the shape the host enforces.

// Declared in loaded manifests, not code. apps/node's pluginConfigs.test.ts checks them.
const MANIFEST_DECLARED = ['linear:issue-summary', 'rollbar:item-summary']

type Shape = { kind: string; mode?: string; max?: number; acceptedMarks?: number; actions?: readonly string[]; key?: readonly string[] }
const shape = (entry: Shape): Shape => {
  const { kind, mode, max, acceptedMarks, actions, key } = entry
  return Object.fromEntries(Object.entries({ kind, mode, max, acceptedMarks, actions, key }).filter(([, value]) => value !== undefined)) as Shape
}

it('lists every registered extension point with the shape the registry holds', () => {
  initClientPlugins(clientPlugins)
  const registered = extensionPointRegistry.entries()
  expect(registered.length).toBeGreaterThan(20)
  for (const entry of registered) {
    const listed = PUBLIC_EXTENSION_POINTS.find((point) => point.id === entry.id)
    expect(listed && shape(listed), entry.id).toEqual(shape(entry))
  }
  const unregistered = PUBLIC_EXTENSION_POINTS.map((point) => point.id).filter((id) => !registered.some((entry) => entry.id === id))
  expect(unregistered).toEqual(MANIFEST_DECLARED)
})
