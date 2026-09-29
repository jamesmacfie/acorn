// Shared display values for rail markers and their tooltip legend. The feature decides which
// markers to show; the kit renders these values without importing the feature.
export type RailTone = 'neutral' | 'accent' | 'warn' | 'danger'

export type RailMarkerDot = 'ok' | 'warn' | 'bad' | 'mixed'

// RailTab serializes these fields as glyph, dot, tone, and label in data-tip-legend.
export type RailLegendItem = { g?: string; d?: RailMarkerDot; t?: RailTone; l: string }
