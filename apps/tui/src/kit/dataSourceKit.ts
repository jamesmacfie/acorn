// Terminal implementations for client-core's feature-owned data-authoring kit seam.
export { Alert, Badge, Button, Field, Fold, Inline, Input, Picker, Select, Stack, Text } from './ui'

// The terminal holds no plugin roster of its own, so a source's provider reads as its plugin id.
export const pluginLabel = (pluginId: string): string => pluginId
