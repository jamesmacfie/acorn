// Connected typed-data authoring for compiled client plugins. Kept off the eager kit and host
// barrels so the source runtime and query editor load only with a consumer that needs them.
export { default as SourceQueryEditor } from '@acorn/client-core/features/dataSources/SourceQueryEditor.tsx'
export { default as TypedBindingPicker } from '@acorn/client-core/features/dataSources/TypedBindingPicker.tsx'
export { default as AuthoringConversation } from '@acorn/client-core/features/dataSources/AuthoringConversation.tsx'
export type { AuthoringConversationProps } from '@acorn/client-core/features/dataSources/AuthoringConversation.tsx'
