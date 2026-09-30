import { describe, expect, it } from 'vitest'
import type { JsonRpcServerRequest } from './jsonRpcProcess'
import { codexServerRequestResponse, normalizeCodexServerRequest } from './codexNormalizer'
import fixture from './__fixtures__/codexComputerUseApproval.json' with { type: 'json' }

// Computer Use's app-access request, rebuilt from the integration's own source
// (./__fixtures__/codexComputerUseApproval.json). Every case below that bends it is synthetic.

type Meta = Record<string, unknown>
const request = (meta: (base: Meta) => Meta = (base) => base, params: Record<string, unknown> = {}): JsonRpcServerRequest => ({
  ...fixture.request,
  params: { ...fixture.request.params, _meta: meta({ ...fixture.request.params._meta }), ...params },
})

const optionIds = (value: JsonRpcServerRequest) => {
  const event = normalizeCodexServerRequest(value)
  return event?.type === 'request' ? event.options?.map((option) => option.id) : undefined
}

describe('Computer Use app-access approval', () => {
  it('names the app by its identifier and offers the scopes the integration advertised', () => {
    expect(normalizeCodexServerRequest(request())).toEqual({
      type: 'request',
      requestId: '31',
      kind: 'elicitation',
      title: 'Allow Computer Use to use "Acorn Agent Test"?',
      questions: [],
      options: [
        { id: 'accept', label: 'Allow for this session', kind: 'allow_once' },
        { id: 'acceptAlways', label: 'Always allow', kind: 'allow_always' },
        { id: 'decline', label: 'Decline', kind: 'reject_once' },
      ],
      approval: {
        connector: 'Computer Use',
        app: { id: 'com.acorn.desktop.agent-test', name: 'Acorn Agent Test' },
        scopes: ['session', 'always'],
      },
    })
  })

  it('answers each choice with the scope the integration reads', () => {
    expect(codexServerRequestResponse(request(), { optionId: 'accept' }))
      .toEqual({ action: 'accept', content: {}, _meta: { persist: 'session' } })
    expect(codexServerRequestResponse(request(), { optionId: 'acceptAlways' }))
      .toEqual({ action: 'accept', content: {}, _meta: { persist: 'always' } })
    expect(codexServerRequestResponse(request(), { optionId: 'decline' })).toEqual({ action: 'decline' })
    expect(codexServerRequestResponse(request(), null)).toEqual({ action: 'cancel' })
  })

  it('offers no persistent choice when the integration only allows a session, and refuses one sent anyway', () => {
    const sessionOnly = request((base) => ({ ...base, persist: ['session'] }))
    expect(optionIds(sessionOnly)).toEqual(['accept', 'decline'])
    expect(() => codexServerRequestResponse(sessionOnly, { optionId: 'acceptAlways' }))
      .toThrow('Computer Use did not offer that approval for Acorn Agent Test.')
  })

  it('refuses an answer the request never offered rather than guessing at it', () => {
    expect(() => codexServerRequestResponse(request(), { optionId: 'acceptForever' })).toThrow()
  })

  it('shows the warning the integration attached', () => {
    const event = normalizeCodexServerRequest(request((base) => ({ ...base, subtitle: 'This app can read your messages.' })))
    expect(event?.type === 'request' ? event.approval?.warning : undefined).toBe('This app can read your messages.')
  })

  it('drops scopes it does not know without inventing any', () => {
    const event = normalizeCodexServerRequest(request((base) => ({ ...base, persist: ['session', 'forever', 7] })))
    expect(event?.type === 'request' ? event.approval?.scopes : undefined).toEqual(['session'])
  })

  // Anything short of the full shape is the consent form it was before, with its plain Allow.
  it.each([
    ['no metadata', request(() => ({}))],
    ['another connector', request((base) => ({ ...base, connector_id: 'node_repl' }))],
    ['no app', request((base) => ({ ...base, tool_params: {} }))],
    ['an app identifier too long to be one', request((base) => ({ ...base, tool_params: { app: 'x'.repeat(501) } }))],
    ['no scopes', request((base) => ({ ...base, persist: undefined }))],
    ['scopes without a session', request((base) => ({ ...base, persist: ['always'] }))],
    ['a malformed scope list', request((base) => ({ ...base, persist: 'always' }))],
  ])('keeps the plain consent form for %s', (_case, value) => {
    const event = normalizeCodexServerRequest(value)
    expect(event).toMatchObject({ kind: 'elicitation' })
    expect(event?.type === 'request' ? event.approval : 'missing').toBeUndefined()
    expect(optionIds(value)).toEqual(['accept', 'decline'])
    expect(codexServerRequestResponse(value, { optionId: 'accept' })).toEqual({ action: 'accept', content: {} })
  })

  it('treats a form with fields as a question even when it carries approval metadata', () => {
    const form = request(undefined, {
      requestedSchema: { type: 'object', properties: { reason: { type: 'string', title: 'Why?' } } },
    })
    expect(normalizeCodexServerRequest(form)).toMatchObject({ kind: 'question', options: [{ id: 'decline' }] })
    expect(codexServerRequestResponse(form, { answers: { reason: 'testing' } }))
      .toEqual({ action: 'accept', content: { reason: 'testing' } })
  })

  it('falls back to the identifier when the integration gives no display name', () => {
    const event = normalizeCodexServerRequest(request((base) => ({ ...base, tool_params_display: [] })))
    expect(event?.type === 'request' ? event.approval?.app : undefined)
      .toEqual({ id: 'com.acorn.desktop.agent-test', name: 'com.acorn.desktop.agent-test' })
  })
})
