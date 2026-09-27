import { describe, expect, it } from 'vitest'
import { pluginWebviewKey } from './webviewModel'

describe('plugin webview key', () => {
  it('separates native page storage across nodes and task surfaces', () => {
    const base = { pluginId: 'docs', nodeId: 'node-a', surface: 'page', taskId: 'task-1' }
    expect(pluginWebviewKey(base)).toBe('plugin:docs:node-a:page:task-1')
    expect(pluginWebviewKey({ ...base, nodeId: 'node-b' })).not.toBe(pluginWebviewKey(base))
    expect(pluginWebviewKey({ ...base, taskId: 'task-2' })).not.toBe(pluginWebviewKey(base))
  })

  it('encodes colons inside each component', () => {
    expect(pluginWebviewKey({ pluginId: 'a:b', nodeId: 'n:1', surface: 's:1' })).toBe('plugin:a%3Ab:n%3A1:s%3A1')
  })
})
