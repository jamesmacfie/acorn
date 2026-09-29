// Pure prompt contracts for workflow generation. The private modules keep teaching text,
// catalog rendering, examples, and request assembly independently readable.
export { renderWorkflowTargets } from './targetPrompt'
export {
  GENERATE_MAX_OUTPUT_TOKENS,
  GENERATE_MAX_SYSTEM_CHARS,
  GENERATE_MAX_CONCEPT_CHARS,
  GENERATE_MAX_FIELD_OPTIONS,
  GENERATE_MAX_PROFILES,
  GENERATE_MAX_EXAMPLES,
  GENERATE_MAX_EXAMPLE_SIZE,
  GENERATE_MAX_REPAIR_PROBLEMS,
} from './generate/limits'
export { FORBIDDEN_KEYS } from './generate/forbiddenKeys'
export { renderStepKinds } from './generate/kinds'
export { renderVocabulary } from './generate/vocabulary'
export { BUILTIN_EXAMPLES } from './generate/builtinExamples'
export { selectExamples, type WorkflowExample } from './generate/workspaceExamples'
export {
  catalogValidation,
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildRepairUserPrompt,
} from './generate/prompts'
