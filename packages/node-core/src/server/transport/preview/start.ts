import type { Duplex } from 'node:stream'
import type { DeviceService } from '../../auth/deviceTokens'
import { startCertificateManager, type PreviewCertificate } from './certificate'
import { PreviewGrants } from './grants'
import type { PreviewOpened, PreviewRequest } from './previewControl'
import { PREVIEW_ENTRY_PATH, createPreviewServer } from './previewServer'

export type PreviewHandle = {
  /** A browser's TLS connection, from a `preview` stream. */
  serve(stream: Duplex): void
  open(request: PreviewRequest): PreviewOpened
  close(): void
}

export type PreviewOptions = {
  /** `<data root>/previews`. */
  dir: string
  nodeId: string
  accountUrl: string
  /** The Node's relay credential, which is what the account service knows it by. */
  credential: string
  /** The Node's own port, which no preview may reach. */
  ownPort: number
  devices: Pick<DeviceService, 'onRevoked'>
}

// A Node's previews, from the certificate to the server that answers on their names. Loaded by the listener
// only when Remote access is on and an account service is named, so a Node without them carries none of it.
export function startPreview(options: PreviewOptions): PreviewHandle {
  const grants = new PreviewGrants()
  const server = createPreviewServer({ grants, ownPort: options.ownPort })
  let current: PreviewCertificate | undefined
  const certificate = startCertificateManager({
    dir: options.dir,
    nodeId: options.nodeId,
    accountUrl: options.accountUrl,
    credential: options.credential,
    install(next) {
      current = next
      server.install(next)
    },
  })
  const offRevoked = options.devices.onRevoked((deviceId) => grants.revokeDevice(deviceId))

  return {
    serve: (stream) => server.serve(stream),
    open(request) {
      const { status } = certificate.state()
      if (status !== 'ready' || !current) return { unavailable: status === 'ready' ? 'starting' : status }
      const { id, entryKey } = grants.open(request)
      return { url: `https://${id}.${current.nodeLabel}.${current.domain}${PREVIEW_ENTRY_PATH}?key=${entryKey}` }
    },
    close() {
      offRevoked()
      certificate.close()
      grants.clear()
      server.close()
    },
  }
}
