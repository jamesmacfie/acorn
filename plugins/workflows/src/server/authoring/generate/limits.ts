/** Leave room for a complete JSON definition with several long step prompts. */
export const GENERATE_MAX_OUTPUT_TOKENS = 8_192

/** Stay below the model runtime's 100,000-character limit; exceeding it returns
 *  `provider_bad_config` rather than truncating the prompt. */
export const GENERATE_MAX_SYSTEM_CHARS = 90_000

/** Section budgets protect required text. The fixed concepts section has a test-enforced limit;
 *  catalog sections degrade in place, and workspace examples can be omitted. */
export const GENERATE_MAX_CONCEPT_CHARS = 22_000
export const GENERATE_MAX_KIND_CHARS = 24_000
export const GENERATE_MAX_VOCABULARY_CHARS = 4_000
export const GENERATE_MAX_EXAMPLE_CHARS = 24_000

/** Bound long option and profile lists without removing their catalog sections. */
export const GENERATE_MAX_FIELD_OPTIONS = 12
export const GENERATE_MAX_PROFILES = 30
export const GENERATE_MAX_EXAMPLES = 4
export const GENERATE_MAX_EXAMPLE_SIZE = 6_000

/** Bound the repair prompt when a model reply produces many validator messages. */
export const GENERATE_MAX_REPAIR_PROBLEMS = 40
