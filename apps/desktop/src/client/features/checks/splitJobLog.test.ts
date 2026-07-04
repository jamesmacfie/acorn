import { describe, expect, it } from 'vitest'
import { splitJobLog, stripTimestamps } from './splitJobLog'

const ts = (s: string) => `2024-06-29T12:34:56.1234567Z ${s}`

describe('splitJobLog', () => {
  it('strips ISO timestamps and normalizes CRLF', () => {
    expect(stripTimestamps(`${ts('hello')}\r\n${ts('world')}`)).toBe('hello\nworld')
  })

  it('slices per step when group count matches step count', () => {
    const log = [ts('##[group]Set up job'), ts('a'), ts('##[endgroup]'), ts('##[group]Run tests'), ts('b'), ts('##[endgroup]')].join('\n')
    const { byStep } = splitJobLog(log, [{ number: 1 }, { number: 2 }])
    expect(byStep.get(1)).toBe('##[group]Set up job\na\n##[endgroup]')
    expect(byStep.get(2)).toBe('##[group]Run tests\nb\n##[endgroup]')
  })

  it('falls back to no per-step slices when counts mismatch', () => {
    const log = [ts('##[group]only one'), ts('x'), ts('##[endgroup]')].join('\n')
    const { byStep, full } = splitJobLog(log, [{ number: 1 }, { number: 2 }])
    expect(byStep.size).toBe(0)
    expect(full).toContain('##[group]only one')
  })
})
