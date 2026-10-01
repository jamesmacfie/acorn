// Raster formats the editor can show without treating active content as a document.
// Keep this list shared by the route and pane so a tab never asks for unsupported bytes.
const imageTypes: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export const MAX_IMAGE_PREVIEW_BYTES = 32 * 1024 * 1024

export const imageTypeForPath = (path: string): string | null =>
  imageTypes[path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''] ?? null
