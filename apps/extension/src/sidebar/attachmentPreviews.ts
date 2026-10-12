import type { BridgeResults } from '@acorn/protocol/extensionBridge.ts'

// Pictures for the attachments a conversation's turns sent, read once each through the task-confined
// `attachment.read` and shown from object URLs. `dispose` revokes every URL made, and a read that
// answers after it makes none, so a closed conversation holds no image memory.
export function attachmentPreviews(read: (attachmentId: string) => Promise<BridgeResults['attachment.read']>) {
  const previews = new Map<string, Promise<string | null>>()
  const made: string[] = []
  let disposed = false
  return {
    // The object URL of an image attachment, or null for one that isn't an image or can't be read.
    url(attachmentId: string): Promise<string | null> {
      let preview = previews.get(attachmentId)
      if (!preview) {
        preview = read(attachmentId).then(
          ({ attachment, data }) => {
            if (disposed || data === null) return null
            const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
            const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mediaType }))
            made.push(url)
            return url
          },
          () => null,
        )
        previews.set(attachmentId, preview)
      }
      return preview
    },
    dispose() {
      disposed = true
      for (const url of made.splice(0)) URL.revokeObjectURL(url)
    },
  }
}
