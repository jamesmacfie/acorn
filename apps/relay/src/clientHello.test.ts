import { connect, type TLSSocket } from 'node:tls'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { MAX_RECORD_BYTES, readClientHello } from './clientHello'

// The first bytes a real TLS client sends, captured from Node's own client, so the parser is checked
// against an implementation that isn't ours.
async function captureHello(serverName: string | undefined): Promise<Buffer> {
  const server = createServer()
  const hello = new Promise<Buffer>((resolve) => server.once('connection', (socket) => socket.once('data', resolve)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const client: TLSSocket = connect({ host: '127.0.0.1', port, ...(serverName ? { servername: serverName } : {}) })
  client.on('error', () => {})
  const bytes = await hello
  client.destroy()
  server.close()
  return bytes
}

describe('readClientHello', () => {
  it('reads the server name a TLS client asks for', async () => {
    const bytes = await captureHello('Abc.def.preview.example')
    expect(readClientHello(bytes)).toEqual({ status: 'complete', serverName: 'abc.def.preview.example' })
  })

  it('says a ClientHello with no server name has none', async () => {
    // Node sends no extension for an IP address.
    expect(readClientHello(await captureHello(undefined))).toEqual({ status: 'complete', serverName: undefined })
  })

  it('waits for the rest of a record that arrives in pieces', async () => {
    const bytes = await captureHello('abc.def.preview.example')
    for (const cut of [0, 3, 5, 40, bytes.length - 1])
      expect(readClientHello(bytes.subarray(0, cut)).status).toBe('incomplete')
  })

  it('refuses what is not a ClientHello', () => {
    expect(readClientHello(Buffer.from('GET / HTTP/1.1\r\n\r\n')).status).toBe('invalid')
    expect(readClientHello(Buffer.from([22, 3, 3, 0xff, 0xff, 0])).status).toBe('invalid')
    // A record that claims to be a ClientHello and stops short inside a field.
    expect(readClientHello(Buffer.from([22, 3, 3, 0, 4, 1, 0, 0, 0])).status).toBe('invalid')
  })

  it('refuses a record larger than TLS allows', () => {
    const header = Buffer.from([22, 3, 3, (MAX_RECORD_BYTES >> 8) & 0xff, 0xff])
    expect(readClientHello(header).status).toBe('invalid')
  })
})
