import { createMemo, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { createDeviceFlow, integrationsOptions, type Project, projectImporterRegistry } from '@acorn/plugin-api/client'
import { Alert, Button, CopyButton } from '@acorn/plugin-api/ui'

// The GitHub branch of the wizard: the device grant, then whatever GitHub registered as a project
// importer. Neither half is written here — the grant is core's shared createDeviceFlow (the same one
// Settings → Integrations runs) and the repo list is the github plugin's own component, reached
// through projectImporterRegistry so this plugin never imports another plugin.
//
// The screen does not leave on its own after an import. An account has many repositories and taking
// several is the normal case, so the list stays put, says what has been added so far, and waits for
// the owner to say they are done.
export default function GithubConnect(props: {
  onImported: (projectIds?: readonly string[]) => void
  onBack: () => void
  added: Project[]
  onContinue: () => void
}) {
  const integrations = createQuery(() => integrationsOptions(true))
  const connected = () =>
    !!integrations.data?.integrations.some((entry) => entry.providerId === 'github' && entry.status === 'connected')
  const flow = createDeviceFlow(() => 'github', async () => { await integrations.refetch() })
  const importer = createMemo(() => projectImporterRegistry.get('github'))

  return (
    <div class="wizard-body">
      <Show
        when={connected()}
        fallback={
          <>
            <h2>Connect GitHub.</h2>
            <p class="wizard-lede">Enter a code at GitHub to sign in. acorn never sees your password.</p>
            <Show
              when={flow.device()}
              fallback={
                <Button class="wizard-primary" onClick={() => void flow.start()} disabled={flow.busy()}>
                  {flow.busy() ? 'Starting…' : 'Get a code'}
                </Button>
              }
            >
              {(started) => (
                <div class="wizard-device">
                  <span class="wizard-device-url">{new URL(started().verificationUri).host}{new URL(started().verificationUri).pathname}</span>
                  <div class="wizard-device-code">
                    <code>{started().userCode}</code>
                    <CopyButton text={() => started().userCode} title="Copy the code" />
                  </div>
                  {/* A real link, not a fetch: main's setWindowOpenHandler routes it through
                      isAllowedExternalUrl → shell.openExternal, so it opens in the owner's browser. */}
                  <Button href={started().verificationUri} target="_blank" rel="noopener noreferrer">Open GitHub</Button>
                  <p class="wizard-waiting">Waiting for approval…</p>
                  <Button variant="bare" class="wizard-link" onClick={flow.cancel}>Cancel</Button>
                </div>
              )}
            </Show>
            <Show when={flow.error()}><Alert>{flow.error()}</Alert></Show>
            <p class="wizard-hint">
              If you close this or deny the request, nothing breaks — you land in the app and can retry
              from Settings → Integrations.
            </p>
          </>
        }
      >
        <h2>Pick your repositories.</h2>
        <p class="wizard-lede">
          Clone them fresh, or map ones you already have on disk. Add as many as you like — anything you
          skip stays in GitHub, and you can import it from Settings whenever you want it.
        </p>
        <Show when={importer()} fallback={<p class="muted">The GitHub importer is not available on this node.</p>}>
          {(entry) => (
            <section class="project-importer wizard-importer" aria-label={entry().label}>
              {/* showClose: the wizard's footer already has back and skip. */}
              <Dynamic component={entry().component} onClose={props.onBack} onImported={props.onImported} showClose={false} />
            </section>
          )}
        </Show>
        {/* The running tally is the whole reason this screen can stay put: without it, adding a third
            repository is an act of faith. */}
        <Show when={props.added.length}>
          <div class="wizard-added">
            <span class="wizard-added-count">
              {props.added.length} project{props.added.length === 1 ? '' : 's'} added
            </span>
            <span class="wizard-added-names">
              <For each={props.added}>{(project) => <span class="wizard-added-name">{project.name}</span>}</For>
            </span>
          </div>
        </Show>
        <Button variant="solid" tone="accent" disabled={!props.added.length} onClick={props.onContinue}>
          {props.added.length ? 'Done adding' : 'Add a repository to continue'}
        </Button>
      </Show>
    </div>
  )
}
