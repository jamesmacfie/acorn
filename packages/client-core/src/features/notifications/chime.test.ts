// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHIMES, playChime, soundSink, type AudioContextLike } from './chime'
import type { Notice } from './notifications'

type Scheduled = { frequencyHz: number; startAt: number; stopAt: number }

// The smallest thing that records what a real context would have played.
function fakeAudio(currentTime = 5): AudioContextLike & { played: Scheduled[] } {
  const played: Scheduled[] = []
  return {
    currentTime,
    destination: {},
    played,
    createOscillator() {
      const note: Scheduled = { frequencyHz: 0, startAt: 0, stopAt: 0 }
      played.push(note)
      return {
        frequency: { setValueAtTime: (value) => { note.frequencyHz = value }, linearRampToValueAtTime: () => {} },
        connect: () => {},
        start: (at) => { note.startAt = at },
        stop: (at) => { note.stopAt = at },
      }
    },
    createGain: () => ({
      gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
      connect: () => {},
    }),
  }
}

describe('the schedules', () => {
  it('are two notes, under 400ms, at a notification volume', () => {
    for (const notes of Object.values(CHIMES)) {
      expect(notes).toHaveLength(2)
      expect(Math.max(...notes.map((n) => n.startMs + n.durationMs))).toBeLessThan(400)
      for (const note of notes) expect(note.gain).toBeLessThan(0.5)
    }
  })

  it('rise for attention and fall for done', () => {
    expect(CHIMES.attention[1]!.frequencyHz).toBeGreaterThan(CHIMES.attention[0]!.frequencyHz)
    expect(CHIMES.done[1]!.frequencyHz).toBeLessThan(CHIMES.done[0]!.frequencyHz)
  })
})

it('plays each note at its own frequency, offset from the context clock', () => {
  const audio = fakeAudio(5)
  playChime('attention', audio)
  expect(audio.played).toEqual(CHIMES.attention.map((note) => ({
    frequencyHz: note.frequencyHz,
    startAt: 5 + note.startMs / 1000,
    stopAt: 5 + (note.startMs + note.durationMs) / 1000,
  })))
})

// The switch. `sound` on is the default a device with no preference reads, so only "off" needs saying.
const settings = vi.hoisted(() => ({ sound: true }))
vi.mock('./settings', async (original) => ({
  ...(await original<object>()),
  readNotificationSettings: () => ({ sound: settings.sound, system: true, badge: true, events: { blocked: true, finished: true, error: true } }),
}))

describe('the sink', () => {
  const notice = (kind: string): Notice => ({ id: 'n1', taskId: 't1', kind, title: 'claude', at: 0, read: false })
  // One context for both tests, because the module builds its own once and keeps it.
  const audio = fakeAudio(0)
  Object.assign(globalThis, { AudioContext: function AudioContext() { return audio } })

  beforeEach(() => { settings.sound = true; audio.played.length = 0 })

  it('rings for an agent that needs you and chimes done for one that finished', () => {
    soundSink(notice('agent-needs-input'))
    expect(audio.played.map((n) => n.frequencyHz)).toEqual(CHIMES.attention.map((n) => n.frequencyHz))
    audio.played.length = 0
    soundSink(notice('agent-completed'))
    expect(audio.played.map((n) => n.frequencyHz)).toEqual(CHIMES.done.map((n) => n.frequencyHz))
  })

  it('is silent when the sound setting is off', () => {
    settings.sound = false
    soundSink(notice('agent-needs-input'))
    expect(audio.played).toEqual([])
  })
})
