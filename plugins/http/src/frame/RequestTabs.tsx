// The request half of the API panel: Params / Body / Headers / Auth / Vars.
// The mode selectors for Body and Auth sit in the tab strip's right slot rather than inside their
// panels — Bruno's arrangement, and it keeps the current mode visible from any tab.
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Input, KeyValueEditor, Select, type TabDef, Tabs, Textarea } from '@acorn/plugin-api/ui'
import { authModes, bodyModes, joinUrl, parseFormBody, splitUrl, type AuthConfig, type BodyMode, type KeyValue } from '../shared/model'
import type { Draft } from './draft'

type RequestTab = 'params' | 'body' | 'headers' | 'auth' | 'vars'

/**
 * The shared editor, adapted to this plugin's `KeyValue` shape (`name` where KVRow says `key`).
 *
 * The grid itself moved to client-core's KeyValueEditor, which was lifted from THIS implementation —
 * including the trailing blank row and the `<Index>`-not-`<For>` rule that keeps an input from losing
 * focus on every keystroke.
 */
function KeyValueTable(props: { rows: KeyValue[]; onChange: (rows: KeyValue[]) => void; nameLabel?: string; valueLabel?: string }) {
  return (
    <KeyValueEditor
      class="http-grid"
      ariaLabel={`${props.nameLabel ?? 'Name'} / ${props.valueLabel ?? 'Value'}`}
      keyPlaceholder={props.nameLabel ?? 'Name'}
      valuePlaceholder={props.valueLabel ?? 'Value'}
      rows={props.rows.map((row) => ({ key: row.name, value: row.value, enabled: row.enabled }))}
      onChange={(rows) => props.onChange(rows.map((row) => ({ name: row.key, value: row.value, enabled: row.enabled ?? true })))}
    />
  )
}

// Per-request variable overrides are a plain Record, not KeyValue[] — they have no enabled flag and
// no kind. Secrets and commands are repo-level, where the server can decrypt and run them.
function VarsTable(props: { vars: Record<string, string>; onChange: (vars: Record<string, string>) => void }) {
  const rows = createMemo<KeyValue[]>(() => Object.entries(props.vars).map(([name, value]) => ({ name, value, enabled: true })))
  return (
    <>
      <p class="http-hint">
        Overrides for this request only. Repo variables (including secrets and command-derived ones) are set in the Variables tab and apply everywhere.
      </p>
      <KeyValueTable
        rows={rows()}
        nameLabel="Variable"
        onChange={(next) => {
          const out: Record<string, string> = {}
          for (const r of next) if (r.name) out[r.name] = r.value
          props.onChange(out)
        }}
      />
    </>
  )
}

function AuthEditor(props: { auth: AuthConfig; onChange: (auth: AuthConfig) => void }) {
  return (
    <div class="http-auth">
      <Show when={props.auth.mode === 'none'}>
        <p class="http-hint">No authentication. Anything you need can also be set directly as a header.</p>
      </Show>

      <Show when={props.auth.mode === 'basic'}>
        {(() => {
          const auth = () => props.auth as Extract<AuthConfig, { mode: 'basic' }>
          return (
            <>
              <label class="http-field">
                <span>Username</span>
                <Input size="sm" value={auth().username} onInput={(e) => props.onChange({ ...auth(), username: e.currentTarget.value })} />
              </label>
              <label class="http-field">
                <span>Password</span>
                <Input size="sm" type="password" value={auth().password} onInput={(e) => props.onChange({ ...auth(), password: e.currentTarget.value })} />
              </label>
            </>
          )
        })()}
      </Show>

      <Show when={props.auth.mode === 'bearer'}>
        {(() => {
          const auth = () => props.auth as Extract<AuthConfig, { mode: 'bearer' }>
          return (
            <label class="http-field">
              <span>Token</span>
              <Input size="sm" value={auth().token} placeholder="{{TOKEN}}" onInput={(e) => props.onChange({ mode: 'bearer', token: e.currentTarget.value })} />
            </label>
          )
        })()}
      </Show>

      <Show when={props.auth.mode === 'apikey'}>
        {(() => {
          const auth = () => props.auth as Extract<AuthConfig, { mode: 'apikey' }>
          return (
            <>
              <label class="http-field">
                <span>Key</span>
                <Input size="sm" value={auth().key} placeholder="X-API-Key" onInput={(e) => props.onChange({ ...auth(), key: e.currentTarget.value })} />
              </label>
              <label class="http-field">
                <span>Value</span>
                <Input size="sm" value={auth().value} placeholder="{{API_KEY}}" onInput={(e) => props.onChange({ ...auth(), value: e.currentTarget.value })} />
              </label>
              <label class="http-field">
                <span>Send in</span>
                <Select size="sm" width="narrow" value={auth().placement} onChange={(e) => props.onChange({ ...auth(), placement: e.currentTarget.value as 'header' | 'query' })}>
                  <option value="header">Header</option>
                  <option value="query">Query string</option>
                </Select>
              </label>
            </>
          )
        })()}
      </Show>

      <p class="http-hint">Whichever mode you pick, this becomes a header (or a query param) when the request is sent — you can see exactly what went out in the response Timeline.</p>
    </div>
  )
}

// Switching auth mode has to build a whole new config object, since each mode carries different
// fields. Defaults are empty rather than carried over — a token is not a password.
const emptyAuth = (mode: AuthConfig['mode']): AuthConfig => {
  switch (mode) {
    case 'basic':
      return { mode: 'basic', username: '', password: '' }
    case 'bearer':
      return { mode: 'bearer', token: '' }
    case 'apikey':
      return { mode: 'apikey', key: '', value: '', placement: 'header' }
    case 'none':
      return { mode: 'none' }
  }
}

export default function RequestTabs(props: { draft: Draft; patch: (patch: Partial<Draft>) => void }) {
  const [tab, setTab] = createSignal<RequestTab>('body')

  const params = createMemo(() => splitUrl(props.draft.url).params)
  const setParams = (rows: KeyValue[]) => props.patch({ url: joinUrl(splitUrl(props.draft.url).base, rows) })

  const formRows = createMemo(() => parseFormBody(props.draft.body))

  const tabs = (): TabDef[] => [
    { id: 'params', label: 'Params', count: params().length || undefined },
    { id: 'body', label: 'Body', count: props.draft.bodyMode === 'none' ? undefined : 1 },
    { id: 'headers', label: 'Headers', count: props.draft.headers.length || undefined },
    { id: 'auth', label: 'Auth', count: props.draft.auth.mode === 'none' ? undefined : 1 },
    { id: 'vars', label: 'Vars', count: Object.keys(props.draft.vars).length || undefined },
  ]

  return (
    <section class="http-request-tabs">
      {/* The mode selectors sit in the strip's trailing slot rather than inside their panels —
          Bruno's arrangement, and it keeps the current mode visible from any tab. Was a sibling div
          plus a `.ui-tabs` override to make room for it. */}
      <Tabs
        class="http-tabstrip"
        tabs={tabs()}
        active={tab()}
        onChange={(id) => setTab(id as RequestTab)}
        idPrefix="http-request"
        ariaLabel="Request"
        actions={
          <>
            <Show when={tab() === 'body'}>
              <Select size="sm" width="narrow" value={props.draft.bodyMode} aria-label="Body type" onChange={(e) => props.patch({ bodyMode: e.currentTarget.value as BodyMode })}>
                <For each={bodyModes}>{(m) => <option value={m}>{m === 'form' ? 'form-urlencoded' : m}</option>}</For>
              </Select>
            </Show>
            <Show when={tab() === 'auth'}>
              <Select size="sm" width="narrow" value={props.draft.auth.mode} aria-label="Auth type" onChange={(e) => props.patch({ auth: emptyAuth(e.currentTarget.value as AuthConfig['mode']) })}>
                <For each={authModes}>{(m) => <option value={m}>{m === 'apikey' ? 'API key' : m}</option>}</For>
              </Select>
            </Show>
          </>
        }
      />

      <Tabs.Panel class="http-tabpanel" idPrefix="http-request" id={tab()} active={tab()}>
        <Show when={tab() === 'params'}>
          <p class="http-hint">Query parameters are part of the URL — editing either side keeps the other in step.</p>
          <KeyValueTable rows={params()} onChange={setParams} nameLabel="Parameter" />
        </Show>

        <Show when={tab() === 'headers'}>
          <KeyValueTable rows={props.draft.headers} onChange={(headers) => props.patch({ headers })} nameLabel="Header" />
        </Show>

        <Show when={tab() === 'body'}>
          <Show when={props.draft.bodyMode === 'none'}>
            <p class="http-hint">This request has no body.</p>
          </Show>
          <Show when={props.draft.bodyMode === 'form'}>
            <KeyValueTable rows={formRows()} onChange={(rows) => props.patch({ body: JSON.stringify(rows) })} nameLabel="Field" />
          </Show>
          <Show when={props.draft.bodyMode === 'json' || props.draft.bodyMode === 'text'}>
            <Textarea
              class="http-body-editor"
              spellcheck={false}
              value={props.draft.body}
              placeholder={props.draft.bodyMode === 'json' ? '{\n  "key": "{{value}}"\n}' : 'Request body'}
              onInput={(e) => props.patch({ body: e.currentTarget.value })}
            />
          </Show>
        </Show>

        <Show when={tab() === 'auth'}>
          <AuthEditor auth={props.draft.auth} onChange={(auth) => props.patch({ auth })} />
        </Show>

        <Show when={tab() === 'vars'}>
          <VarsTable vars={props.draft.vars} onChange={(vars) => props.patch({ vars })} />
        </Show>
      </Tabs.Panel>
    </section>
  )
}

export { KeyValueTable }
