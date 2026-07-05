import { describe, expect, it } from 'vitest'
import { buildAxTree, isAllowedBrowserUrl, isBenignNavError, renderAxTree, resolveRef, type CdpAxNode } from './browserAuto'

// A trimmed real-world Accessibility.getFullAXTree payload: RootWebArea → generic wrapper →
// form with a textbox + button, plus an ignored node.
const FIXTURE: CdpAxNode[] = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Login' }, childIds: ['2'], backendDOMNodeId: 1 },
  { nodeId: '2', parentId: '1', role: { value: 'generic' }, childIds: ['3', '6'], backendDOMNodeId: 2 },
  { nodeId: '3', parentId: '2', role: { value: 'form' }, name: { value: 'login form' }, childIds: ['4', '5'], backendDOMNodeId: 3 },
  { nodeId: '4', parentId: '3', role: { value: 'textbox' }, name: { value: 'Email' }, value: { value: '' }, backendDOMNodeId: 4 },
  { nodeId: '5', parentId: '3', role: { value: 'button' }, name: { value: 'Sign in' }, backendDOMNodeId: 5 },
  { nodeId: '6', parentId: '2', role: { value: 'generic' }, ignored: true, childIds: ['7'], backendDOMNodeId: 6 },
  { nodeId: '7', parentId: '6', role: { value: 'StaticText' }, name: { value: 'Forgot password?' }, backendDOMNodeId: 7 },
]

describe('buildAxTree (docs/panes.md — CDP AX payload → refs)', () => {
  it('builds a compact tree: anonymous structure flattened, refs on actionable nodes', () => {
    const snap = buildAxTree(FIXTURE)
    expect(snap.tree).toEqual([
      {
        ref: 'e1',
        role: 'RootWebArea',
        name: 'Login',
        children: [
          {
            ref: 'e2',
            role: 'form',
            name: 'login form',
            children: [
              { ref: 'e3', role: 'textbox', name: 'Email' },
              { ref: 'e4', role: 'button', name: 'Sign in' },
            ],
          },
          { ref: 'e5', role: 'StaticText', name: 'Forgot password?' },
        ],
      },
    ])
    // ref → backendDOMNodeId mapping
    expect(snap.refs.get('e3')).toBe(4)
    expect(snap.refs.get('e4')).toBe(5)
  })

  it('renderAxTree emits the compact indented form', () => {
    const snap = buildAxTree(FIXTURE)
    const text = renderAxTree(snap.tree)
    expect(text).toContain('- textbox "Email" [e3]')
    expect(text).toContain('  - form "login form" [e2]')
  })
})

describe('ref resolution', () => {
  it('resolves refs from the last snapshot and rejects stale/unknown refs', () => {
    const snap = buildAxTree(FIXTURE)
    expect(resolveRef(snap, 'e4')).toBe(5)
    expect(() => resolveRef(snap, 'e99')).toThrow(/Stale or unknown ref 'e99'/)
    expect(() => resolveRef(null, 'e1')).toThrow(/browser_snapshot first/)
  })
})

describe('guards', () => {
  it('ERR_ABORTED is benign; only http(s) urls are drivable', () => {
    expect(isBenignNavError({ errno: -3, code: 'ERR_ABORTED' })).toBe(true)
    expect(isBenignNavError(new Error('ERR_ABORTED (-3) loading'))).toBe(true)
    expect(isBenignNavError(new Error('ERR_CONNECTION_REFUSED'))).toBe(false)
    expect(isAllowedBrowserUrl('http://localhost:5173/login')).toBe(true)
    expect(isAllowedBrowserUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedBrowserUrl('javascript:alert(1)')).toBe(false)
  })
})
