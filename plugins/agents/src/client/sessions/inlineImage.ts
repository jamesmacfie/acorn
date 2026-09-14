// What this plugin can draw as a picture, and how it gets one onto the page.
//
// Shared by the two things a session shows: an artifact the agent produced, and an attachment the
// reader sent. Both arrive as bytes rather than as a URL — there is no origin a browser could fetch
// either from (see managedClient.ts) — so both end up as a data URL, and both refuse anything they
// cannot be sure is an image.

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export const isInlineImageType = (mediaType: string | undefined): boolean =>
  INLINE_IMAGE_TYPES.has(mediaType?.split(';', 1)[0]?.trim().toLowerCase() ?? '')

export const dataUrl = async (bytes: Uint8Array, mediaType: string): Promise<string | null> => {
  if (typeof FileReader === 'undefined') return null
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(new Blob([bytes as unknown as BlobPart], { type: mediaType }))
  })
}

/** A filename as markdown alt text. The inline parser reads `![alt](url)` with a bracket-free alt, so
 *  a file called `shot[1].png` would otherwise come out as literal text beside a broken image. */
export const imageAlt = (filename: string): string =>
  filename.replaceAll('[', '').replaceAll(']', '').replaceAll('(', '').replaceAll(')', '').trim()
