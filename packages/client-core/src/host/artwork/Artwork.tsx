import { createMemo, onCleanup } from 'solid-js'
import { artworkReferenceSchema, isArtworkPreset, type ArtworkPreset } from '@acorn/protocol/artwork.ts'
import { ArtworkFrame } from '../../kit/components/content/ArtworkFrame'
import { acquireArtwork, type ArtworkOwner } from './artworkResources'

// `Artwork`, the one component contract for a plugin's picture: a compiled pane imports it from
// `@acorn/plugin-api/ui`, a tree names it as a node, and the rail draws it on a source button. Each
// caller hands over a reference and who it belongs to; this resolves it through the shared reads in
// ./artworkResources.ts and draws the kit's frame. Props are read defensively, because a tree's arrive
// as wire data.

export type ArtworkProps = {
  /** The picture: a path on the owner's Node routes, the revision of its bytes, and its alt text. */
  image?: { path: string; revision: string; alt: string }
  /** Whose Node and plugin `image` belongs to. A tree host binds this from the mount and ignores any
   *  value the tree sent; a compiled caller passes its own. */
  owner?: ArtworkOwner
  /** `thumbnail` unless named: `rail`, `thumbnail`, or `detail`. */
  preset?: ArtworkPreset
  /** Words drawn in the square when there is no picture. */
  fallback?: string
  /** A glyph drawn in the square whenever the picture isn't, instead of the placeholder and `fallback`. */
  icon?: string
  /** Leave the picture out of the accessibility tree, for a parent whose description already says what
   *  it shows. */
  decorative?: boolean
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

export function Artwork(props: ArtworkProps) {
  const reference = createMemo(() => {
    const parsed = artworkReferenceSchema.safeParse(props.image)
    return parsed.success ? parsed.data : undefined
  })
  const key = createMemo(() => {
    const image = reference()
    const owner = props.owner
    if (!image || !text(owner?.nodeId) || !text(owner?.pluginId)) return null
    return JSON.stringify([owner!.nodeId, owner!.pluginId, image.path, image.revision])
  })
  // Acquired while rendering rather than after, so the first frame already draws the placeholder and
  // not the fallback. A changed key releases the previous picture in the same pass.
  const resource = createMemo(() => {
    const value = key()
    if (!value) return undefined
    const [nodeId, pluginId, path, revision] = JSON.parse(value) as string[]
    const acquired = acquireArtwork({ nodeId, pluginId }, { path, revision })
    onCleanup(acquired.release)
    return acquired
  })
  const status = () => resource()?.status()

  return (
    <ArtworkFrame
      preset={isArtworkPreset(props.preset) ? props.preset : 'thumbnail'}
      src={status() === 'ready' ? resource()!.url() : undefined}
      pending={status() === 'loading'}
      alt={props.decorative === true ? '' : reference()?.alt}
      fallback={text(props.fallback)}
      icon={text(props.icon)}
    />
  )
}
