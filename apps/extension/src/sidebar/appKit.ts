// The sidebar's `@acorn/plugin-api/ui`: the kit components an agent-built app's runtime draws with, and
// nothing else. The facade's barrel carries the whole design system, the diff viewer, and the editor
// pieces, which the sidebar doesn't ship. vite.config.ts and vitest.config.ts alias the facade here,
// and tsconfig.json's `paths` says the same for tsc. An app component the runtime starts drawing needs
// a line here.
export {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '@acorn/client-core/kit/components/primitives.tsx'
export { default as CopyButton } from '@acorn/client-core/kit/components/inputs/CopyButton.tsx'
export { Modal, ModalActions, ModalBody } from '@acorn/client-core/kit/components/overlays'
export { Inline, Stack } from '@acorn/client-core/kit/components/layout'
export { Heading, Text } from '@acorn/client-core/kit/components/content'
