import { describe, expect, it } from 'vitest'
import { mountEmbeddedEditor } from './embed'

// `.test.tsx`, so it runs under jsdom: a code box is DOM or it is nothing
// (../../../vitest.config.ts § hosts).

describe('mountEmbeddedEditor', () => {
  it('draws an editor in the element and hands back the text', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const editor = mountEmbeddedEditor(host, { doc: '{"a":1}', languageId: 'json' })

    expect(host.querySelector('.cm-editor')).toBeTruthy()
    expect(editor.read()).toBe('{"a":1}')

    editor.write('{\n  "a": 1\n}\n')
    expect(editor.read()).toBe('{\n  "a": 1\n}\n')

    editor.destroy()
    expect(host.querySelector('.cm-editor')).toBeNull()
    host.remove()
  })

  it('reports what the reader typed, and takes the keyboard away when read-only', () => {
    const typed: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const editor = mountEmbeddedEditor(host, {
      doc: '{}',
      languageId: 'json',
      onChange: (text) => typed.push(text),
    })
    // Through `write`, which is the same transaction a keystroke makes: jsdom has no typing.
    editor.write('{"b":2}')
    expect(typed).toEqual(['{"b":2}'])
    editor.destroy()

    // Read-only is about the reader, not about `write`: Format still reprints the box on a committed
    // file, and it is Apply that the editor greys out (plugins/workflows JsonTab.tsx).
    const locked = mountEmbeddedEditor(host, { doc: '{}', languageId: 'json', readOnly: true })
    expect(host.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
    locked.write('{"c":3}')
    expect(locked.read()).toBe('{"c":3}')
    locked.destroy()
    host.remove()
  })
})
