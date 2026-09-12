import type {
  AgentCommandDescriptor,
  AgentConfigOption,
  AgentNormalizedEvent,
  AgentQuestion,
  AgentSkillDescriptor,
} from '@acorn/protocol/managedAgents.ts'
import { safeProviderMessage } from '../drivers/diagnostics'

const sliceText = (value: string | undefined, max = 16_384): string | undefined =>
  value == null ? undefined : value.slice(0, max)

const boundedConfig = (option: AgentConfigOption): AgentConfigOption => ({
  ...option,
  id: option.id.slice(0, 200),
  label: option.label.slice(0, 500),
  currentValue: sliceText(option.currentValue ?? undefined, 2_000) ?? null,
  values: option.values.slice(0, 100).map((value) => ({
    value: value.value.slice(0, 2_000),
    label: value.label.slice(0, 500),
    description: sliceText(value.description, 4_000),
  })),
})

const boundedCommands = (commands: AgentCommandDescriptor[] | undefined): AgentCommandDescriptor[] | undefined =>
  commands?.slice(0, 200).map((command) => ({
    name: command.name.slice(0, 200),
    description: sliceText(command.description, 4_000),
    inputHint: sliceText(command.inputHint, 1_000),
  }))

const boundedSkills = (skills: AgentSkillDescriptor[] | undefined): AgentSkillDescriptor[] | undefined =>
  skills?.slice(0, 200).map((skill) => ({
    name: skill.name.slice(0, 200),
    description: sliceText(skill.description, 4_000),
    path: sliceText(skill.path, 4_096),
  }))

const boundedCount = (value: number | undefined): number | undefined =>
  value == null || !Number.isFinite(value) ? undefined : Math.max(0, Math.round(value))

const boundedQuestion = (question: AgentQuestion): AgentQuestion => ({
  ...question,
  id: question.id.slice(0, 2_000),
  header: sliceText(question.header, 500),
  prompt: question.prompt.slice(0, 16_384),
  options: question.options?.slice(0, 100).map((option) => ({
    id: option.id.slice(0, 2_000),
    label: option.label.slice(0, 500),
    description: sliceText(option.description, 4_000),
  })),
})

// Provider processes are trusted to execute only within their declared profile, but their protocol
// text is still untrusted storage/rendering input. Keep normalized events bounded before they reach
// SQLite or the client; large tool output and patches are moved to artifacts by the runtime.
export function boundProviderEvent(
  event: AgentNormalizedEvent,
  secretValues: Iterable<string>,
): AgentNormalizedEvent {
  switch (event.type) {
    case 'assistant_message':
    case 'reasoning':
      return { ...event, subagentId: sliceText(event.subagentId, 2_000) }
    case 'user_message':
      return { ...event, text: event.text.slice(0, 64 * 1024) }
    case 'session_state':
      return { ...event, detail: sliceText(event.detail, 4_000) }
    case 'session_metadata':
      return {
        ...event,
        providerSessionRef: sliceText(event.providerSessionRef, 2_000),
        configOptions: event.configOptions?.slice(0, 100).map(boundedConfig),
        commands: boundedCommands(event.commands),
        skills: boundedSkills(event.skills),
      }
    case 'tool':
      return {
        ...event,
        tool: {
          ...event.tool,
          id: event.tool.id.slice(0, 2_000),
          parentId: sliceText(event.tool.parentId, 2_000),
          title: event.tool.title.slice(0, 500),
          kind: sliceText(event.tool.kind, 200),
          paths: event.tool.paths?.slice(0, 200).map((path) => path.slice(0, 4_096)),
          subagentId: sliceText(event.tool.subagentId, 2_000),
        },
      }
    case 'plan':
      return {
        ...event,
        entries: event.entries.slice(0, 200).map((entry) => ({
          ...entry,
          id: entry.id.slice(0, 2_000),
          text: entry.text.slice(0, 16_384),
        })),
      }
    case 'request':
      return {
        ...event,
        requestId: event.requestId.slice(0, 2_000),
        title: event.title.slice(0, 500),
        detail: sliceText(event.detail, 16_384),
        options: event.options?.slice(0, 100).map((option) => ({
          ...option,
          id: option.id.slice(0, 2_000),
          label: option.label.slice(0, 500),
        })),
        questions: event.questions?.slice(0, 50).map(boundedQuestion),
      }
    case 'request_resolved':
      return event
    case 'artifact':
      return {
        ...event,
        artifactId: event.artifactId.slice(0, 2_000),
        title: event.title.slice(0, 500),
        mediaType: sliceText(event.mediaType, 200),
      }
    case 'file_change':
      return {
        ...event,
        path: sliceText(event.path, 4_096),
        summary: sliceText(event.summary, 16_384),
        subagentId: sliceText(event.subagentId, 2_000),
      }
    case 'terminal':
      return {
        ...event,
        terminalSessionId: event.terminalSessionId.slice(0, 2_000),
        title: event.title.slice(0, 500),
      }
    case 'error':
      return {
        ...event,
        code: event.code.slice(0, 200),
        message: safeProviderMessage(event.message, 'Provider reported an error.', secretValues),
      }
    case 'diagnostic':
      return {
        ...event,
        message: safeProviderMessage(event.message, 'Provider reported a diagnostic.', secretValues),
      }
    case 'subagent':
      return {
        ...event,
        subagent: {
          ...event.subagent,
          id: event.subagent.id.slice(0, 2_000),
          title: sliceText(event.subagent.title, 500),
          role: sliceText(event.subagent.role, 200),
          model: sliceText(event.subagent.model, 200),
          providerAgentRef: sliceText(event.subagent.providerAgentRef, 2_000),
          // Clamped rather than sliced: these reach the sidebar as numbers, and a provider reporting a
          // nonsense count should not render as one.
          toolUseCount: boundedCount(event.subagent.toolUseCount),
          durationMs: boundedCount(event.subagent.durationMs),
        },
      }
    case 'usage':
    case 'turn_completed':
      return event
  }
}
