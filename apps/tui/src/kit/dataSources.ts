// The terminal entrypoint for the shared connected data controls. Vite compiles their JSX through
// the terminal reconciler, while their controller and compatibility model remain client-core's.
export { default as SourceQueryEditor } from '@acorn/client-core/features/dataSources/SourceQueryEditor.tsx'
export { default as TypedBindingPicker } from '@acorn/client-core/features/dataSources/TypedBindingPicker.tsx'
export { default as AuthoringConversation } from '@acorn/client-core/features/dataSources/AuthoringConversation.tsx'
export type { AuthoringConversationProps } from '@acorn/client-core/features/dataSources/AuthoringConversation.tsx'
