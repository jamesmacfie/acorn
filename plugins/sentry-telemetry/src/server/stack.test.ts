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
      filename: '<data>/plugins/github/dist/node.js',
      abs_path: '<data>/plugins/github/dist/node.js',
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

  it('marks a dependency and a builtin as out of app', () => {
    const frames = parseStack(STACK)
    expect(frames.find((frame) => frame.filename?.includes('node_modules'))?.in_app).toBe(false)
    expect(frames.find((frame) => frame.filename?.startsWith('node:'))?.in_app).toBe(false)
  })

  it('skips the message line and anything that is not a frame', () => {
    expect(parseStack('Error: boom\nsomething else entirely')).toEqual([])
  })

  it('answers an empty list for an empty stack rather than throwing', () => {
    expect(parseStack('')).toEqual([])
  })
})
