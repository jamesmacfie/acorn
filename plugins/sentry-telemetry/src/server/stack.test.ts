import { describe, expect, it } from 'vitest'
import { parseStack } from './stack'

const STACK = [
  'TypeError: cannot read a property of undefined',
  '    at refresh (<data>/plugins/github/dist/node.js:120:11)',
  '    at async runOnce (~/src/acorn/packages/node-core/src/server/schedules/scheduler.ts:398:22)',
  '    at listOnTimeout (node:internal/timers:594:17)',
  '    at /Users/example/node_modules/hono/dist/hono-base.js:12:3',
].join('\n')

describe('parseStack', () => {
  it('reads the function, the file, the line and the column', () => {
    expect(parseStack(STACK).at(-1)).toEqual({
      function: 'refresh',
      filename: 'app:///plugins/github/dist/node.js',
      abs_path: 'app:///plugins/github/dist/node.js',
      lineno: 120,
      colno: 11,
      in_app: true,
    })
  })

  it('reverses the order, because Sentry draws the last frame as the one that threw', () => {
    // V8 writes newest first. Without this the issue shows the timer loop as the failing line.
    expect(parseStack(STACK).map((frame) => frame.function ?? frame.filename)).toEqual([
      '/Users/example/node_modules/hono/dist/hono-base.js',
      'listOnTimeout',
      'async runOnce',
      'refresh',
    ])
  })

  it('names a packaged file the way its source map was uploaded, wherever the app is installed', () => {
    const stack = [
      'Error: boom',
      '    at openDataRoot (file:///Applications/Acorn.app/Contents/Resources/helper/chunks/storage-B09q.js:1:3409)',
      '    at boot (C:\\Program Files\\Acorn\\helper\\service.js:1:20)',
      '    at sync (file://~/Applications/Acorn.app/Contents/Resources/plugins/rollbar/dist/node.js:4:5)',
      '    at next (~/src/acorn/apps/desktop/src/helper/helperMain.ts:9:1)',
    ].join('\n')
    expect(parseStack(stack).map((frame) => frame.abs_path)).toEqual([
      '~/src/acorn/apps/desktop/src/helper/helperMain.ts',
      'app:///plugins/rollbar/dist/node.js',
      'app:///helper/service.js',
      'app:///helper/chunks/storage-B09q.js',
    ])
  })

  it('marks a dependency and a builtin as out of app', () => {
    const frames = parseStack(STACK)
    expect(frames.find((frame) => frame.filename?.includes('node_modules'))?.in_app).toBe(false)
    expect(frames.find((frame) => frame.filename?.startsWith('node:'))?.in_app).toBe(false)
  })

  it('skips the message line and anything that is not a frame', () => {
    expect(parseStack('Error: boom\nsomething else entirely\nError: contact me@example.com')).toEqual([])
  })

  it('keeps WebKit renderer frames, including anonymous calls and native frames', () => {
    const stack = [
      'slotFor@app://acorn/assets/workerHost.js:1:153',
      'mount@http://app.localhost/assets/RemoteTree.js:2:253',
      '@app://acorn/assets/AgentPane.js:3:42',
      'forEach@[native code]',
    ].join('\n')
    expect(parseStack(stack)).toEqual([
      { function: 'forEach', in_app: false },
      {
        filename: 'app://acorn/assets/AgentPane.js',
        abs_path: 'app://acorn/assets/AgentPane.js',
        lineno: 3,
        colno: 42,
        in_app: true,
      },
      {
        function: 'mount',
        filename: 'http://app.localhost/assets/RemoteTree.js',
        abs_path: 'http://app.localhost/assets/RemoteTree.js',
        lineno: 2,
        colno: 253,
        in_app: true,
      },
      {
        function: 'slotFor',
        filename: 'app://acorn/assets/workerHost.js',
        abs_path: 'app://acorn/assets/workerHost.js',
        lineno: 1,
        colno: 153,
        in_app: true,
      },
    ])
  })

  it('answers an empty list for an empty stack rather than throwing', () => {
    expect(parseStack('')).toEqual([])
  })
})
