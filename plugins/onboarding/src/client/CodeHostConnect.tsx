import { createMemo, Index, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import {
  createCredentialForm,
  createDeviceFlow,
  integrationsOptions,
  type Project,
  projectImporterRegistry,
} from '@acorn/plugin-api/client'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  CopyButton,
  Field,
  Heading,
  Inline,
  Input,
  Stack,
  Text,
  Toolbar,
} from '@acorn/plugin-api/ui'
import type { CredentialField, PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { safeVerificationUrl } from '@acorn/protocol/externalUrl.ts'
import { AddedTally } from './AddedTally'

// One code host's branch of the wizard: connect it, then whatever its plugin registered as a project
// importer under the provider's id. Neither half is written here. A device-flow provider runs core's
// shared createDeviceFlow, and any other fills the fields its descriptor declares through
// createCredentialForm, as Settings → Services does. The repo list is the code host plugin's own
// component, reached through projectImporterRegistry so this plugin never imports another plugin.
//
// The screen doesn't leave on its own after an import. An account has many repositories and taking
// several is normal, so the list stays put, says what has been added so far, and waits for the owner
// to press the wizard's Next, which reads "Done adding" here.
export default function CodeHostConnect(props: {
  provider: PublicIntegrationProvider
  onImported: (projectIds?: readonly string[]) => void
  onBack: () => void
  added: Project[]
}) {
  const label = () => props.provider.label
  const integrations = createQuery(() => integrationsOptions(true))
  const connected = () =>
    !!integrations.data?.integrations.some(
      (entry) => entry.providerId === props.provider.id && entry.status === 'connected',
    )
  const refetch = async () => {
    await integrations.refetch()
  }
  const flow = createDeviceFlow(() => props.provider.id, refetch)
  const form = createCredentialForm(() => props.provider, refetch)
  const deviceFlow = () => props.provider.connection.kind === 'device-flow'
  const importer = createMemo(() => projectImporterRegistry.get(props.provider.id))

  return (
    <Stack gap="row">
      <Show
        when={connected()}
        fallback={
          <Stack gap="row">
            <Heading
              level={2}
              help={`If you don't finish signing in, nothing breaks. You can connect ${label()} later in Settings, under Services.`}
            >
              Connect {label()}
            </Heading>
            <Show
              when={deviceFlow()}
              fallback={
                <Stack gap="row">
                  <Text emphasis="muted" wrap>
                    acorn checks with {label()} before it saves anything.
                  </Text>
                  {/* Drawn from `connection.fields`, so nothing about the provider's credential is
                      written down here. */}
                  <Index each={form.fields()}>
                    {(field) => (
                      <Show
                        when={field().type === 'checkbox'}
                        fallback={
                          <Field label={field().label} hint={field().hint}>
                            <Input
                              width="auto"
                              type={field().type as Exclude<CredentialField['type'], 'checkbox'>}
                              placeholder={field().placeholder}
                              value={form.value(field().id)}
                              onInput={(value) => form.setValue(field().id, value)}
                              onSubmit={() => void form.submit()}
                            />
                          </Field>
                        }
                      >
                        <Checkbox
                          label={field().label}
                          hint={field().hint}
                          checked={form.value(field().id) === 'true'}
                          onChange={(checked) => form.setValue(field().id, checked ? 'true' : '')}
                        />
                      </Show>
                    )}
                  </Index>
                  <Toolbar variant="actions" size="sm">
                    <Button busy={form.busy()} disabled={!form.complete()} onPress={() => void form.submit()}>
                      Connect
                    </Button>
                  </Toolbar>
                  <Show when={form.error()}>{(text) => <Alert>{text()}</Alert>}</Show>
                </Stack>
              }
            >
              <Text emphasis="muted" wrap>
                Enter a code at {label()} to sign in. acorn never sees your password.
              </Text>
              <Show
                when={flow.device()}
                fallback={
                  <Toolbar variant="actions" size="sm">
                    <Button onPress={() => void flow.start()} disabled={flow.busy()}>
                      {flow.busy() ? 'Starting…' : 'Get a code'}
                    </Button>
                  </Toolbar>
                }
              >
                {(started) => (
                  <Card>
                    <Stack gap="row">
                      <Show
                        when={safeVerificationUrl(started().verificationUri)}
                        fallback={
                          <Alert>{label()} sent a sign-in link that acorn doesn't trust. Cancel and try again.</Alert>
                        }
                      >
                        {(url) => (
                          <Text emphasis="muted">
                            {url().host}
                            {url().pathname}
                          </Text>
                        )}
                      </Show>
                      {/* The code is the thing to read, so it gets the emphasis. */}
                      <Inline gap="inline">
                        <Text emphasis="mono">{started().userCode}</Text>
                        <CopyButton text={() => started().userCode} title="Copy the code" />
                      </Inline>
                      <Toolbar variant="actions" size="sm">
                        {/* A real link, not a fetch: the shell's external-URL gate routes it to the
                            owner's browser. */}
                        <Show when={safeVerificationUrl(started().verificationUri)}>
                          {(url) => <Button href={url().href}>Open {label()}</Button>}
                        </Show>
                        <Button variant="ghost" onPress={flow.cancel}>
                          Cancel
                        </Button>
                      </Toolbar>
                      <Text emphasis="muted">Waiting for you to approve on {label()}…</Text>
                    </Stack>
                  </Card>
                )}
              </Show>
              <Show when={flow.error()}>{(text) => <Alert>{text()}</Alert>}</Show>
            </Show>
          </Stack>
        }
      >
        <Stack gap="row">
          <Heading level={2}>Choose repositories</Heading>
          <Text emphasis="muted" wrap>
            Clone a repository, or link one you already have on this computer. You can import more later in Settings.
          </Text>
          <Show
            when={importer()}
            fallback={<Text emphasis="muted">{label()} import isn't available on this computer.</Text>}
          >
            {(entry) => (
              // showClose: the wizard's own chrome already has back and skip.
              <Dynamic
                component={entry().component}
                onClose={props.onBack}
                onImported={props.onImported}
                showClose={false}
              />
            )}
          </Show>
          {/* The running tally is the whole reason this screen can stay put: without it, adding a third
              repository is an act of faith. */}
          <AddedTally added={props.added} />
        </Stack>
      </Show>
    </Stack>
  )
}
