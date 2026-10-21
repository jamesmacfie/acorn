import type { NodeFetchBody } from '@acorn/protocol/broker.ts'

// A broker request's body, as a page's own `fetch` sends it. A leaf on purpose: the mobile shell's
// transport uses it before the platform seam exists, so it may import nothing that reads the seam.

export const bodyForFetch = (body: NodeFetchBody | undefined): BodyInit | undefined => {
  if (!body) return undefined
  if (body.kind === 'bytes') return body.bytes.byteLength === 0 ? undefined : (body.bytes as unknown as BodyInit)
  const form = new FormData()
  for (const part of body.parts) {
    if ('value' in part) form.append(part.name, part.value)
    else form.append(part.name, new Blob([part.bytes as unknown as BlobPart], { type: part.type }), part.filename)
  }
  return form
}
