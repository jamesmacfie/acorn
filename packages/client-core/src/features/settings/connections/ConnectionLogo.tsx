import Icon from '../../../kit/components/content/Icon'
import { brandStyle } from '../../../kit/tokens/brandMarks'

/** A provider's branded square. The tint comes off the mark the provider names, not off a rule keyed
 *  to its id, so a plugin that ships a mark ships the colour with it. */
export function ConnectionLogo(props: { glyph: string }) {
  return (
    <span class="integration-logo" style={brandStyle(props.glyph)}>
      <span class="integration-logo-mono"><Icon name={props.glyph} /></span>
    </span>
  )
}
