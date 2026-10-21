import { describe, expect, it } from 'vitest'
import { parseCliArgs } from './args'
import { validateCommand } from './commands'
import { mobileGatewayArgs } from './mobile'

const parse = (...argv: string[]) => parseCliArgs(argv)
const refused =
  (...argv: string[]) =>
  () =>
    validateCommand(parse(...argv))

describe('acorn mobile', () => {
  it('serves with no command, and takes only the gateway’s flags', () => {
    expect(refused('mobile', '--origin', 'https://studio.tail.ts.net', '--node', 'studio')).not.toThrow()
    expect(refused('mobile', '--output', 'json')).toThrow('--output is not supported')
    expect(refused('mobile', 'start')).toThrow('mobile takes no command')
  })

  it('lists and revokes sessions without the serving flags', () => {
    expect(refused('mobile', 'sessions')).not.toThrow()
    expect(refused('mobile', 'revoke', 'abc123')).not.toThrow()
    expect(refused('mobile', 'revoke')).toThrow('needs a session ID')
    expect(refused('mobile', 'sessions', '--port', '4000')).toThrow('--port is not supported')
  })

  it('hands the gateway its flags, with the packaged app unless one is named', () => {
    expect(mobileGatewayArgs(parse('mobile', '--port', '4400'), '/app/mobile')).toEqual([
      '--port',
      '4400',
      '--app-dir',
      '/app/mobile',
    ])
    expect(mobileGatewayArgs(parse('mobile', '--app-dir', 'dist'), '/app/mobile')).toEqual(['--app-dir', 'dist'])
    expect(mobileGatewayArgs(parse('mobile', 'revoke', 'abc123'), '/app/mobile')).toEqual(['revoke', 'abc123'])
    expect(mobileGatewayArgs(parse('mobile', 'sessions'), '/app/mobile')).toEqual(['sessions'])
  })
})
