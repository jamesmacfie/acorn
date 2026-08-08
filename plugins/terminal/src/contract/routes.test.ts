import { describe, expect, it } from 'vitest'
import { terminalProfilesRoute, terminalSessionActionRoute, terminalSessionsRoute } from './routes'

describe('terminal contract routes', () => {
  it('keeps the plugin namespace and encodes session ids', () => {
    expect(terminalSessionsRoute).toBe('/v2/p/terminal/sessions')
    expect(terminalProfilesRoute).toBe('/v2/p/terminal/profiles')
    expect(terminalSessionActionRoute('session/with spaces', 'resize')).toBe('/v2/p/terminal/sessions/session%2Fwith%20spaces/resize')
  })

  it('only builds the supported session actions', () => {
    expect(terminalSessionActionRoute('s1', 'kill')).toBe('/v2/p/terminal/sessions/s1/kill')
    expect(terminalSessionActionRoute('s1', 'send')).toBe('/v2/p/terminal/sessions/s1/send')
  })
})
