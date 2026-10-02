import { describe, expect, it } from 'vitest'
import { styleValueProblem } from './styleValues'

describe('style value alphabet', () => {
  it('accepts bounded values from the principal token families', () => {
    expect(styleValueProblem('--space-1', '3px')).toBeNull()
    expect(styleValueProblem('--radius-sm', '8px')).toBeNull()
    expect(styleValueProblem('--font-mono', '"JetBrains Mono", monospace')).toBeNull()
    expect(styleValueProblem('--label-transform', 'capitalize')).toBeNull()
    expect(styleValueProblem('--shadow-2', '0 4px 16px var(--shadow-popover)')).toBeNull()
    expect(styleValueProblem('--dur-short', '120ms')).toBeNull()
    expect(styleValueProblem('--surface-border-style', 'dashed')).toBeNull()
  })

  it('accepts the role aliases the built-in packs restate, as a literal or a reference', () => {
    expect(styleValueProblem('--gap-row', '5px')).toBeNull()
    expect(styleValueProblem('--radius-surface', 'var(--radius-lg)')).toBeNull()
    expect(styleValueProblem('--font-ui', "'Nunito', ui-rounded, sans-serif")).toBeNull()
    expect(styleValueProblem('--elev-card', 'var(--shadow-2)')).toBeNull()
    expect(styleValueProblem('--elev-pane', '0 3px 0 var(--shadow-popover)')).toBeNull()
    expect(styleValueProblem('--card-bg', 'var(--bg-subtle)')).toBeNull()
  })

  it('refuses a reference to another family, a derived token, a colour, or itself', () => {
    expect(styleValueProblem('--radius-surface', 'var(--space-4)')).not.toBeNull()
    expect(styleValueProblem('--radius-surface', 'var(--radius)')).not.toBeNull()
    expect(styleValueProblem('--radius-surface', 'var(--radius-surface)')).not.toBeNull()
    expect(styleValueProblem('--card-bg', 'var(--accent)')).not.toBeNull()
    expect(styleValueProblem('--card-bg', '#fff')).not.toBeNull()
    expect(styleValueProblem('--elev-card', 'var(--ring)')).not.toBeNull()
  })

  it('rejects executable syntax, wrong families, literals in shadows, and derived tokens', () => {
    for (const value of ['url(x)', 'expression(x)', '1px; color: red', '1px}']) {
      expect(styleValueProblem('--space-1', value)).not.toBeNull()
    }
    expect(styleValueProblem('--space-1', 'var(--shadow-1)')).not.toBeNull()
    expect(styleValueProblem('--shadow-2', '0 4px 16px #000')).not.toBeNull()
    expect(styleValueProblem('--surface-border', '1px dashed red')).toContain('host-derived')
    expect(styleValueProblem('--font-glyph', 'Nunito')).toContain('host-derived')
    expect(styleValueProblem('--unknown', '1px')).toContain('unknown')
  })
})
