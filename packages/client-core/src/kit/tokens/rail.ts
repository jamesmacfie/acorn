// Shared display values for rail markers and their tooltip legend. The feature decides which
// markers to show; the kit renders these values without importing the feature.
export type RailTone = 'neutral' | 'accent' | 'warn' | 'danger'

// `mixed` is half bad and half warn (checks failing and pending). `diff` is half ok and half bad
// (lines added and lines removed).
export type RailMarkerDot = 'ok' | 'warn' | 'bad' | 'mixed' | 'diff'

// RailTab serializes these fields as glyph, dot, tone, and label in data-tip-legend.
export type RailLegendItem = { g?: string; d?: RailMarkerDot; t?: RailTone; l: string }
