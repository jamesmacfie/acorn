import { describe, expect, it } from 'vitest'
import { buildFillScript } from './browserAuto'

// The accessibility-tree half of this suite left with its subject, for plugins/browser
// (docs/future/tauri/webviews-and-frames.md § Agent browser automation). What is left is preview's
// own: the page-rule fill script.

describe('buildFillScript (page rules)', () => {
  it('embeds selector and value as JSON so quotes/backticks/newlines cannot escape the script', () => {
    const script = buildFillScript(`input[name="pw"]`, 'a"b`c${d}\ne\\f')
    expect(script).toContain(JSON.stringify('input[name="pw"]'))
    expect(script).toContain(JSON.stringify('a"b`c${d}\ne\\f'))
    // The raw (unescaped) value must not appear anywhere outside its JSON form.
    expect(script).not.toContain('a"b`c${d}\ne\\f')
    // Parses as a single expression (would throw on injection-broken syntax).
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })
  it('sets via the native prototype setter and dispatches input+change', () => {
    const script = buildFillScript('#pw', 'x')
    expect(script).toContain("Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val)")
    expect(script).toContain("new Event('input', { bubbles: true })")
    expect(script).toContain("new Event('change', { bubbles: true })")
  })
})
