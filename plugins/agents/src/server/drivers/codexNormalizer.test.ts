import { describe, expect, it } from 'vitest'
import {
  codexServerRequestResponse,
  normalizeCodexNotification,
  normalizeCodexServerRequest,
} from './codexNormalizer'

describe('Codex app-server normalization', () => {
  it('maps protocol readiness without terminal heuristics', () => {
    expect(normalizeCodexNotification({
      method: 'thread/status/changed',
      params: { threadId: 'thread-1', status: { type: 'idle' } },
    })).toEqual([{ type: 'session_state', state: 'ready' }])
  })

  it('maps approval identity and advertised choices', () => {
    const event = normalizeCodexServerRequest({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'git push', reason: 'network' },
    })
    expect(event).toMatchObject({
      type: 'request',
      requestId: '42',
      kind: 'permission',
      detail: 'git push',
    })
    expect(event?.type === 'request' ? event.options?.map((option) => option.id) : []).toContain('acceptForSession')
  })

  it('turns an empty MCP form into consent controls and translates their answers', () => {
    const request = {
      id: 7,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'openai/form',
        message: 'Allow Computer Use to use "Firefox Developer Edition"?',
        requestedSchema: { type: 'object', properties: {} },
      },
    }

    expect(normalizeCodexServerRequest(request)).toEqual({
      type: 'request',
      requestId: '7',
      kind: 'elicitation',
      title: 'Allow Computer Use to use "Firefox Developer Edition"?',
      questions: [],
      options: [
        { id: 'accept', label: 'Allow', kind: 'allow_once' },
        { id: 'decline', label: 'Decline', kind: 'reject_once' },
      ],
    })
    expect(codexServerRequestResponse(request, { optionId: 'accept' }))
      .toEqual({ action: 'accept', content: {} })
    expect(codexServerRequestResponse(request, { optionId: 'decline' }))
      .toEqual({ action: 'decline' })
    expect(codexServerRequestResponse(request, null)).toEqual({ action: 'cancel' })
  })

  it('turns an MCP form schema into questions and sends typed content back', () => {
    const request = {
      id: 8,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'form',
        message: 'Choose how to continue.',
        requestedSchema: {
          type: 'object',
          properties: {
            browser: {
              type: 'string',
              title: 'Browser',
              oneOf: [
                { const: 'firefox-dev', title: 'Firefox Developer Edition' },
                { const: 'safari', title: 'Safari' },
              ],
            },
            retries: { type: 'integer', title: 'Retry count' },
          },
        },
      },
    }

    expect(normalizeCodexServerRequest(request)).toMatchObject({
      type: 'request',
      requestId: '8',
      kind: 'question',
      title: 'Choose how to continue.',
      questions: [
        {
          id: 'browser',
          prompt: 'Browser',
          options: [
            { id: 'firefox-dev', label: 'Firefox Developer Edition' },
            { id: 'safari', label: 'Safari' },
          ],
        },
        { id: 'retries', prompt: 'Retry count' },
      ],
      options: [{ id: 'decline', label: 'Skip', kind: 'reject_once' }],
    })
    expect(codexServerRequestResponse(request, {
      answers: { browser: 'Firefox Developer Edition', retries: '2' },
    })).toEqual({
      action: 'accept',
      content: { browser: 'firefox-dev', retries: 2 },
    })
  })

  it('maps message deltas and usage', () => {
    expect(normalizeCodexNotification({
      method: 'item/agentMessage/delta',
      params: { itemId: 'message-1', delta: 'hello' },
    })).toEqual([{ type: 'assistant_message', text: 'hello', messageId: 'message-1', append: true }])
    expect(normalizeCodexNotification({
      method: 'thread/tokenUsage/updated',
      params: {
        tokenUsage: {
          total: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, cacheWriteInputTokens: 1, totalTokens: 17 },
          modelContextWindow: 100,
        },
      },
    })).toEqual([{ type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, cacheWriteInputTokens: 1, contextUsed: 17, contextSize: 100 } }])
  })

  it('maps each Codex plan snapshot with its structured status intact', () => {
    expect(normalizeCodexNotification({
      method: 'turn/plan/updated',
      params: {
        plan: [
          { step: 'Inspect `session/start`', status: 'completed' },
          { step: 'Update the projection', status: 'inProgress' },
          { step: 'Verify the UI', status: 'pending' },
        ],
      },
    })).toEqual([{
      type: 'plan',
      entries: [
        { id: 'plan-0', text: 'Inspect `session/start`', status: 'completed' },
        { id: 'plan-1', text: 'Update the projection', status: 'in_progress' },
        { id: 'plan-2', text: 'Verify the UI', status: 'pending' },
      ],
    }])
  })

  it('extracts completed generated images as transient provider artifacts', async () => {
    const result = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const notification = {
      method: 'item/completed',
      params: {
        item: {
          type: 'imageGeneration',
          id: 'image-1',
          status: 'completed',
          result,
        },
      },
    }

    const { codexGeneratedArtifact } = await import('./codexNormalizer')
    const artifact = codexGeneratedArtifact(notification)
    expect(artifact).toMatchObject({
      type: 'generated_artifact',
      kind: 'file',
      title: 'Generated image.png',
      mediaType: 'image/png',
    })
    expect(Array.from(artifact?.bytes ?? [])).toEqual(Array.from(Buffer.from(result, 'base64')))
    expect(normalizeCodexNotification(notification)).toEqual([{
      type: 'tool',
      tool: { id: 'image-1', title: 'Generated image', kind: 'image', status: 'completed' },
    }])
  })
})
