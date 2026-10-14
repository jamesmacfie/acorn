import type { AgentConfigOption, AgentSession } from './wire.ts'

// How a session's model reads on screen. Here rather than in the client because the browser bridge
// writes the same line on the rows it sends the extension.

/**
 * The model a session is running. The `model` column on the session row is never written: the live
 * provider reports its choice as a `session_metadata` config option, and that is what a model switch
 * updates, so `config.configOptions` is the only place the current answer lives. Returns the option's
 * value label where the provider gave one, since a raw id like `claude-opus-4-1-20250805` is not what
 * anyone calls it.
 */
export const sessionModelLabel = (session: AgentSession): string | undefined => {
  const options = session.config.configOptions
  if (!Array.isArray(options)) return session.model ?? undefined
  const model = (options as AgentConfigOption[]).find((option) => option.category === 'model')
  if (!model?.currentValue) return session.model ?? undefined
  return model.values.find((value) => value.value === model.currentValue)?.label ?? model.currentValue
}

/**
 * The compact model summary shown in session views. Reasoning is a separate provider option for
 * Codex, so the model label alone loses a setting that materially changes the session. Keep the
 * dashboard's typed model value separate; this is presentation text for places where the two facts
 * belong beside each other.
 */
export const sessionModelSummary = (session: AgentSession): string | undefined => {
  const model = sessionModelLabel(session)
  if (!model) return undefined
  const options = session.config.configOptions
  if (!Array.isArray(options)) return model
  const reasoning = (options as AgentConfigOption[]).find((option) => option.category === 'reasoning')
  if (!reasoning?.currentValue) return model
  const effort =
    reasoning.values.find((value) => value.value === reasoning.currentValue)?.label ?? reasoning.currentValue
  return `${model} · ${effort}`
}
