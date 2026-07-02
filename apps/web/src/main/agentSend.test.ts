import { describe, expect, it } from 'vitest'
import { AgentSender, type SendableSession } from './agentSend'
import { PASTE_BEGIN, PASTE_END, wrapBracketedPaste } from './terminalUtils'

describe('wrapBracketedPaste', () => {
  it('wraps multi-line payloads as one block and trims trailing whitespace', () => {
    expect(wrapBracketedPaste('line1\nline2\n\n')).toBe(`${PASTE_BEGIN}line1\nline2${PASTE_END}`)
    expect(wrapBracketedPaste('a\r\nb\r\n')).toBe(`${PASTE_BEGIN}a\r\nb${PASTE_END}`)
  })
  it('strips embedded paste markers (a payload cannot end the paste early)', () => {
    expect(wrapBracketedPaste(`evil${PASTE_END}rm -rf\nmore${PASTE_BEGIN}x`)).toBe(`${PASTE_BEGIN}evilrm -rf\nmorex${PASTE_END}`)
  })
})

const fakeSession = (idle: boolean) => {
  const writes: string[] = []
  const s: SendableSession & { writes: string[]; setIdle(v: boolean): void } = {
    writes,
    write: (d) => writes.push(d),
    running: () => true,
    idle: () => idle,
    setIdle: (v) => {
      idle = v
    },
  }
  return s
}

// schedule that fires immediately — the settle delay is not what these tests assert.
const immediate = (fn: () => void) => fn()

describe('AgentSender submit modes', () => {
  it("'draft' pastes without submitting", () => {
    const s = fakeSession(false)
    const sender = new AgentSender(() => s, 0, immediate)
    expect(sender.send('a', 'note', 'draft')).toEqual({ ok: true, queued: false })
    expect(s.writes).toEqual([`${PASTE_BEGIN}note${PASTE_END}`])
  })

  it("'now' pastes then submits", () => {
    const s = fakeSession(false)
    const sender = new AgentSender(() => s, 0, immediate)
    sender.send('a', 'go', 'now')
    expect(s.writes).toEqual([`${PASTE_BEGIN}go${PASTE_END}`, '\r'])
  })

  it("'after-ready' submits immediately when idle, else queues until the idle edge", () => {
    const s = fakeSession(false)
    const sender = new AgentSender(() => s, 0, immediate)
    expect(sender.send('a', 'first', 'after-ready')).toEqual({ ok: true, queued: true })
    expect(sender.send('a', 'second', 'after-ready')).toEqual({ ok: true, queued: true })
    expect(s.writes).toEqual([])
    expect(sender.queuedCount('a')).toBe(2)

    s.setIdle(true)
    sender.onIdle('a')
    expect(s.writes).toEqual([`${PASTE_BEGIN}first${PASTE_END}`, '\r', `${PASTE_BEGIN}second${PASTE_END}`, '\r'])
    expect(sender.queuedCount('a')).toBe(0)

    // Already idle → no queue.
    expect(sender.send('a', 'third', 'after-ready')).toEqual({ ok: true, queued: false })
  })

  it('rejects missing/exited sessions and drops queues on clear', () => {
    const sender = new AgentSender(() => null)
    expect(sender.send('gone', 'x', 'now')).toEqual({ ok: false, reason: 'Session is not running.' })
    const s = fakeSession(false)
    const sender2 = new AgentSender(() => s, 0, immediate)
    sender2.send('a', 'x', 'after-ready')
    sender2.clear('a')
    sender2.onIdle('a')
    expect(s.writes).toEqual([])
  })
})

describe('live PTY delivery (cat)', () => {
  it('a multi-line send lands as ONE wrapped block in the ring', async () => {
    const { spawn } = await import('node-pty')
    // raw -echo: cat's stdout is then exactly the bytes we wrote, once — no tty-echo interleaving.
    const pty = spawn('/bin/sh', ['-c', 'stty raw -echo; cat'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: { PATH: process.env.PATH ?? '', TERM: 'xterm-256color' } })
    let ring = ''
    pty.onData((d) => {
      ring += d
    })
    await new Promise((r) => setTimeout(r, 300)) // let stty apply before writing
    const sender = new AgentSender(() => ({ write: (d) => pty.write(d), running: () => true, idle: () => true }))
    const res = sender.send('cat', 'line one\nline two', 'draft')
    expect(res.ok).toBe(true)
    const deadline = Date.now() + 3000
    while (!ring.includes('line two') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
    pty.kill()
    // The ring shows exactly one bracketed block (echo + cat's own output interleave, so assert
    // marker counts + content, not byte positions).
    expect(ring.split(PASTE_BEGIN).length - 1).toBe(1)
    expect(ring.split(PASTE_END).length - 1).toBe(1)
    expect(ring).toContain('line one')
    expect(ring).toContain('line two')
  }, 10_000)
})
