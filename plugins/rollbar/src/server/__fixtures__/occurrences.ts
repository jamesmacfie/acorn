// Synthetic Rollbar fixtures — NO real token, occurrence value, IP, person, or request body. Field
// names and type/shape variants only, enough to exercise the normalizer (server/normalize.ts).
import type { RollbarApiInstance, RollbarApiItem } from '../'

export const ITEM: RollbarApiItem = {
  id: 999,
  counter: 142,
  title: 'TypeError: token is null',
  level: 40,
  environment: 'prod',
  status: 'active',
  total_occurrences: 142,
  first_occurrence_timestamp: 1_700_000_000,
  last_occurrence_timestamp: 1_700_100_000,
  framework: 'node',
  last_occurrence_id: 555,
  last_activated_timestamp: 1_700_050_000,
  unique_occurrences: 12,
  resolved_in_version: null,
  assigned_user_id: null,
}

// Sparse item: missing optionals, string level, no timestamps.
export const SPARSE_ITEM = {
  id: 12,
  counter: 7,
  title: 'weird',
  level: 'warning',
  environment: 'stage',
  status: 'active',
  total_occurrences: 0,
} as unknown as RollbarApiItem

export const TRACE_INSTANCE: RollbarApiInstance = {
  id: 555,
  timestamp: 1_700_100_000,
  data: {
    uuid: 'aaaa-bbbb',
    context: 'auth#login',
    environment: 'prod',
    code_version: 'aabbcc1',
    platform: 'linux',
    language: 'javascript',
    framework: 'node',
    server: { host: 'api-2', branch: 'main' },
    person: { id: 'user-123', username: 'jo', email: 'jo@example.test' },
    notifier: { name: 'node_rollbar', version: '2.0.0' },
    request: { method: 'POST', url: '/api/login', headers: { authorization: 'SECRET' }, body: 'SECRET' },
    body: {
      trace: {
        exception: { class: 'TypeError', message: 'token is null' },
        frames: [
          { filename: 'auth/session.ts', lineno: 84, colno: 12, method: 'readSession', code: 'return s.token', in_app: true, context: { pre: ['a', 'b'], post: ['c', 'd'] } },
          { filename: 'api/login.ts', lineno: 31, method: 'login' },
        ],
      },
    },
  },
}

export const TRACE_CHAIN_INSTANCE: RollbarApiInstance = {
  id: 556,
  timestamp: 1_700_100_500,
  occurrence: {
    body: {
      trace_chain: [
        { exception: { class: 'OuterError', message: 'wrapped' }, frames: [{ filename: 'a.ts', lineno: 1 }] },
        { exception: { class: 'InnerError', message: 'root cause' }, frames: [{ filename: 'b.ts', lineno: 2 }] },
      ],
    },
  },
}

export const MESSAGE_INSTANCE: RollbarApiInstance = {
  id: 557,
  timestamp: 1_700_101_000,
  occurrence: { body: { message: { body: 'disk almost full' } } },
}

export const CRASH_INSTANCE: RollbarApiInstance = {
  id: 558,
  occurrence: { body: { crash_report: { raw: 'SHOULD NOT SURVIVE' } } },
}

export const UNKNOWN_INSTANCE: RollbarApiInstance = { id: 559, occurrence: { body: {} } }
