import { createSignal, Show } from 'solid-js'
import type { ArtworkPreset } from '@acorn/protocol/artwork.ts'
import Icon from './Icon'

// The square a picture sits in, at one of the kit's named sizes. Presentation only: the host resolves
// a plugin's reference into a checked local URL (host/artwork/Artwork.tsx), and this draws whatever it
// is handed. The box keeps its size while loading and after a failure, so a picture never moves the
// layout around it.

export type ArtworkFrameProps = {
  preset: ArtworkPreset
  /** A local object URL the host already checked. Never a Node or provider address. */
  src?: string
  /** The host is still resolving `src`, so the box draws its placeholder rather than its fallback. */
  pending?: boolean
  /** What the picture shows. Empty leaves it out of the accessibility tree. */
  alt?: string
  /** Words drawn in the box when there is no picture. */
  fallback?: string
  /** A glyph drawn in the box whenever the picture isn't, in place of the placeholder and `fallback`. */
  icon?: string
}

export function ArtworkFrame(props: ArtworkFrameProps) {
  // Which source has finished loading, and which failed. Compared with the current `src`, so a new
  // picture draws the placeholder until its own bytes are ready rather than the one before it.
  const [loaded, setLoaded] = createSignal<string>()
  const [broken, setBroken] = createSignal<string>()
  const drawn = () => !!props.src && loaded() === props.src
  const failed = () => !!props.src && broken() === props.src
  const fallback = () => (!props.pending && (!props.src || failed()) ? props.fallback : undefined)

  return (
    <span class="ui-artwork" data-preset={props.preset} data-drawn={drawn() || undefined}>
      <Show when={!failed() && props.src} keyed>
        {(src) => (
          <img
            src={src}
            alt={props.alt ?? ''}
            aria-hidden={props.alt ? undefined : true}
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(src)}
            onError={() => setBroken(src)}
          />
        )}
      </Show>
      <Show when={!drawn()}>
        <Show when={props.icon} fallback={<Show when={fallback()}>{(text) => <span>{text()}</span>}</Show>}>
          {(name) => <Icon name={name()} />}
        </Show>
      </Show>
    </span>
  )
}
