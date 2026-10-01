import { randomBytes } from 'node:crypto'
import { request as httpRequest, type Agent as HttpAgent, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest, type Agent as HttpsAgent } from 'node:https'
import type { NodeFetchBody, NodeFetchResponse } from '@acorn/protocol/broker.ts'

// One HTTP round trip to a node, over node:http(s) rather than global fetch.
//
// Certificate pinning needs a custom CA plus a checkServerIdentity override, and those live on an
// https.Agent, which global fetch can't accept: undici takes a `dispatcher`, ignores `agent`, and offers
// no route to a per-request CA without adding undici as a direct dependency. node:https.request takes
// the agent natively, and `ws` uses the same agent internally, so one pinned agent serves both the HTTP
// and the WebSocket path.

export type NodeRequestOptions = {
  url: URL
  method: string
  headers: Record<string, string>
  body?: NodeFetchBody
  agent: HttpAgent | HttpsAgent
  signal: AbortSignal
  // Internal caller limit. A renderer cannot raise the transport ceiling.
  maxResponseBytes?: number
}

// Normal JSON, document, and diff reads fit below this. The broker currently returns a whole body
// over its process boundary, so an unbounded response from a paired Node must never reach that path.
export const MAX_NODE_RESPONSE_BYTES = 64 * 1024 * 1024

export class NodeResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The node response exceeds the ${maxBytes} byte limit.`)
    this.name = 'NodeResponseTooLargeError'
  }
}

// Shared by the pinned transport and the unverified probe. Content-Length is an early rejection,
// not an authority: chunked and dishonest responses are counted before each chunk is retained.
export function readBoundedResponse(res: IncomingMessage, maxBytes: number): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const declared = res.headers['content-length']
    if (declared && /^\d+$/.test(declared) && BigInt(declared) > BigInt(maxBytes)) {
      res.destroy()
      reject(new NodeResponseTooLargeError(maxBytes))
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      res.off('data', onData)
      res.off('end', onEnd)
      res.off('error', onError)
      res.off('close', onClose)
    }
    const onData = (chunk: Buffer) => {
      if (chunk.length > maxBytes - size) {
        cleanup()
        res.destroy()
        reject(new NodeResponseTooLargeError(maxBytes))
        return
      }
      size += chunk.length
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks, size))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error('The node closed the response before it finished.'))
    }
    res.on('data', onData)
    res.once('end', onEnd)
    res.once('error', onError)
    res.once('close', onClose)
  })
}

export function nodeRequest(options: NodeRequestOptions): Promise<NodeFetchResponse> {
  const { url, agent, signal } = options
  if (signal.aborted) return Promise.reject(abortError())
  const encoded = encodeBody(options.body)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise<NodeFetchResponse>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())

    const req: ClientRequest = send(
      url,
      {
        method: options.method,
        agent,
        headers: {
          // Order matters. A caller's content-type must survive for a `bytes` body, which is how JSON
          // gets labelled, so `encoded.contentType` is null there and only fills in as a default. For
          // multipart it isn't null and must win, because only the encoder knows the boundary.
          ...(encoded?.contentType ? { 'content-type': encoded.contentType } : {}),
          ...options.headers,
          ...(encoded
            ? {
                'content-type': encoded.contentType ?? options.headers['content-type'] ?? 'application/octet-stream',
                'content-length': String(encoded.body.byteLength),
              }
            : {}),
        },
      },
      (res) => {
        void readBoundedResponse(res, Math.min(options.maxResponseBytes ?? MAX_NODE_RESPONSE_BYTES, MAX_NODE_RESPONSE_BYTES)).then((body) => {
          const headers: Record<string, string> = {}
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue
            // set-cookie is the one header Node models as an array. Nothing here consumes cookies, but
            // joining rather than dropping keeps it honest.
            headers[key] = Array.isArray(value) ? value.join(', ') : value
          }
          resolve({ status: res.statusCode ?? 0, headers, body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) })
        }, reject)
      },
    )

    const onAbort = () => {
      req.destroy(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    req.on('close', () => signal.removeEventListener('abort', onAbort))
    req.on('error', reject)
    if (encoded) req.write(encoded.body)
    req.end()
  })
}

const abortError = (): Error => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })

// contentType is null when the caller owns it (a `bytes` body may be JSON, text or binary) and set when
// the encoder owns it (multipart, where only we know the boundary).
type Encoded = { body: Buffer; contentType: string | null }

// Multipart is encoded here rather than handed to FormData, because http.request takes a buffer, not a
// web BodyInit. About 20 lines and fully under test, versus a dependency or a second unpinned transport.
function encodeBody(body: NodeFetchBody | undefined): Encoded | null {
  if (!body) return null
  if (body.kind === 'bytes') {
    if (body.bytes.byteLength === 0) return null
    return { body: Buffer.from(body.bytes), contentType: null }
  }

  const boundary = `acorn${randomBytes(16).toString('hex')}`
  const chunks: Buffer[] = []
  for (const part of body.parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    if ('value' in part) {
      chunks.push(Buffer.from(`content-disposition: form-data; name="${escapeQuoted(part.name)}"\r\n\r\n`))
      chunks.push(Buffer.from(part.value))
    } else {
      chunks.push(
        Buffer.from(
          `content-disposition: form-data; name="${escapeQuoted(part.name)}"; filename="${escapeQuoted(part.filename)}"\r\n` +
            `content-type: ${part.type || 'application/octet-stream'}\r\n\r\n`,
        ),
      )
      chunks.push(Buffer.from(part.bytes))
    }
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

// A quote or CR/LF in a field name would break out of the header and let a caller forge part headers.
// RFC 7578 says percent-encode; stripping the structural characters is enough here, because these names
// are our own route contracts rather than user text.
const escapeQuoted = (value: string): string => value.replace(/[\r\n"]/g, '')
