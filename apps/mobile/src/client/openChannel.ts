import { runChannelClient, type ChannelClient, type ChannelListeners } from '@acorn/channel/client.ts'
import { openChannel } from '@acorn/channel/secure.ts'
import { RELAY_BROWSER_STREAM, relayCredentialProtocols, relayUrls } from '@acorn/protocol/relay.ts'
import { fetchTicket } from './account'

// A channel to one Node, the way the phone opens it (docs/relay/phone-channel.md): a ticket from the
// account, a browser stream through the relay offered with that ticket, and the handshake against the
// key the phone pinned. Each step leaves a `performance` measure, `acorn.channel.<step>`, which is where
// to read how long a connection took.
//
// It imports nothing that reads the platform seam, because `main.tsx` installs the seam before the app
// loads.

const measured = async <T>(step: string, work: Promise<T>): Promise<T> => {
  const start = performance.now()
  try {
    return await work
  } finally {
    performance.measure(`acorn.channel.${step}`, { start, end: performance.now() })
  }
}

const connected = (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    // A browser says nothing about why: the relay answered with a status, or didn't answer.
    socket.addEventListener('error', () => reject(new Error('The relay didn’t open a stream to the Node.')), {
      once: true,
    })
  })

export async function openNodeChannel(
  nodeId: string,
  channelKey: string,
  listeners: ChannelListeners,
): Promise<ChannelClient> {
  const { ticket, relayUrl } = await measured('ticket', fetchTicket(nodeId))
  const socket = new WebSocket(
    relayUrls.connect(relayUrl, nodeId, RELAY_BROWSER_STREAM),
    relayCredentialProtocols(ticket),
  )
  await measured('socket', connected(socket))
  return runChannelClient(await measured('handshake', openChannel(socket, channelKey)), listeners)
}
