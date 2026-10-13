import { expect, test } from 'vitest'
import { parseAgentSessionOptions } from './options.mjs'
import { parseTuiAgentOptions } from '../../../../scripts/agent-tui-options.mjs'

test.each([
  ['desktop', parseAgentSessionOptions],
  ['terminal', parseTuiAgentOptions],
])('%s driver accepts each workspace mode and rejects invalid or onboarding combinations', (_name, parse) => {
  expect(parse(['--session', 'example', '--workspaces', 'on']).workspaces).toBe('on')
  expect(parse(['--session', 'example', '--workspaces', 'off']).workspaces).toBe('off')
  expect(() => parse(['--session', 'example', '--workspaces', 'other'])).toThrow('--workspaces must be on or off')
  expect(() => parse(['--session', 'example', '--onboarding', '--workspaces', 'on'])).toThrow('--workspaces cannot be used with --onboarding')
})

test('desktop smoke mode also rejects an explicit workspace mode', () => {
  expect(() => parseAgentSessionOptions(['--session', 'example', '--smoke', '--workspaces', 'off']))
    .toThrow('--workspaces cannot be used with --onboarding')
})

test('replay options bind telemetry mode to the generated fixture', () => {
  const options = parseAgentSessionOptions(['--session', 'replay', '--fixture', 'streaming-replay', '--telemetry', 'off', '--prepared'])
  expect(options).toMatchObject({ fixture: 'streaming-replay', telemetry: 'off', prepared: true })
  expect(() => parseAgentSessionOptions(['--telemetry', 'on'])).toThrow('--telemetry is only')
  expect(() => parseAgentSessionOptions(['--fixture', 'streaming-replay', '--telemetry', 'other'])).toThrow('--telemetry must be')
})
