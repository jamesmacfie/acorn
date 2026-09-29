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
  })

  it('rejects executable syntax, wrong families, literals in shadows, and derived tokens', () => {
    for (const value of ['url(x)', 'expression(x)', '1px; color: red', '1px}']) {
      expect(styleValueProblem('--space-1', value)).not.toBeNull()
    }
    expect(styleValueProblem('--space-1', 'var(--shadow-1)')).not.toBeNull()
    expect(styleValueProblem('--shadow-2', '0 4px 16px #000')).not.toBeNull()
    expect(styleValueProblem('--gap-row', '5px')).toContain('host-derived')
    expect(styleValueProblem('--unknown', '1px')).toContain('unknown')
  })
})
