import { createMemo, createSignal, For, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import type { Integration } from '@acorn/protocol/api.ts'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { safeVerificationUrl } from '@acorn/protocol/externalUrl.ts'
import { integrationsKey } from '../../../infra/queries'
import { createCredentialForm } from '../../integrations/credentialForm'
import { createDeviceFlow } from '../../integrations/deviceFlow'
import CopyButton from '../../../kit/components/inputs/CopyButton'
import { Alert, Button, Card, EmptyState, Input } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { useSettingsDetail } from '../settingsDetail'
import { useUnsavedChanges } from '../unsavedChanges'
import { ConnectionLogo } from './ConnectionLogo'
import { galleryCards, providerAsks, type GalleryCard } from './connections'

// Add connection: a gallery of every provider this node can connect, built from the descriptors the
// providers publish, then one provider's steps on the same page (docs/integrations.md § Settings).
// Nothing here names a provider, so a plugin that registers one gets a card with no change here.
//
// A provider at its `maxConnections` stays in the gallery, marked as connected, and its card opens the
// connection. Hiding it left the reader looking for a provider that was already there.
//
// The steps are what the descriptor asks for. Typed fields are a form with Connect and Cancel, and
// anything typed counts as unsaved. A device-flow provider shows the code to enter at the provider, and
// a code that is still waiting counts as unsaved too, because leaving stops the polling that would
// finish it. The fields, the write and the pacing live in ../../integrations/, because first-run
// onboarding connects a provider the same way.

export type AddConnectionProps = {
  providers: readonly PublicIntegrationProvider[]
  connections: readonly Integration[]
  /** Which providers this page offers. AI models offers only the model providers. */
  offers?: (provider: PublicIntegrationProvider) => boolean
  /** A line for a card whose connections another page lists, such as "Listed on AI models". */
  listedOn?: (provider: PublicIntegrationProvider) => string | undefined
  openConnection: (connection: Integration) => void
  /** The list page the gallery was opened from, for the back link. */
  listLabel: string
  onClose: () => void
}

const limitText = (card: GalleryCard): string => {
  const max = card.provider.connection.maxConnections
  if (card.full) return max === 1 ? 'Connected, one allowed' : `Connected, ${max} allowed`
  return card.connections.length ? `${card.connections.length} connected` : ''
}

export function AddConnection(props: AddConnectionProps) {
  const qc = useQueryClient()
  const [chosen, setChosen] = createSignal<PublicIntegrationProvider>()
  const cards = createMemo(() => galleryCards(props.providers, props.connections).filter((card) => props.offers?.(card.provider) ?? true))

  const connected = async () => {
    await qc.invalidateQueries({ queryKey: integrationsKey })
    props.onClose()
  }
  const form = createCredentialForm(chosen, connected)
  const deviceFlow = createDeviceFlow(() => chosen()?.id, connected)
  useUnsavedChanges(() => !!chosen() && (!!deviceFlow.device() || form.fields().some((field) => !!form.value(field.id).trim())))

  const pick = (card: GalleryCard) => {
    if (card.full) {
      const only = card.connections.length === 1 ? card.connections[0] : undefined
      if (only) props.openConnection(only)
      else props.onClose()
      return
    }
    form.reset()
    setChosen(card.provider)
  }
  const backToGallery = () => {
    form.reset()
    deviceFlow.cancel()
    setChosen(undefined)
  }

  // One detail registration for both steps, so the header names the step on screen and its back link
  // goes one step back: from a provider's steps to the gallery, from the gallery to the list.
  const hostDrawsBack = useSettingsDetail(
    () => (chosen() ? `Connect ${chosen()?.label}` : 'Add connection'),
    () => (chosen() ? backToGallery() : props.onClose()),
    () => (chosen() ? 'Add connection' : props.listLabel),
  )

  return (
    <>
      <Show when={!hostDrawsBack}>
        <Inline><Button variant="bare" size="sm" onPress={() => (chosen() ? backToGallery() : props.onClose())}>‹ {chosen() ? 'Add connection' : props.listLabel}</Button></Inline>
      </Show>
      <Show
        when={chosen()}
        fallback={
          <SettingsSection id="gallery" label="Providers" description="Pick one to see what it asks for.">
            <Show when={cards().length} fallback={<EmptyState align="start">No provider on this node can be connected. A plugin adds them.</EmptyState>}>
              <div class="connection-gallery">
                <For each={cards()}>
                  {(card) => (
                    <Card onPress={() => pick(card)} stripe={card.full ? 'ok' : undefined} title={card.full ? `Open ${card.provider.label}` : `Connect ${card.provider.label}`}>
                      <span class="connection-card">
                        <ConnectionLogo glyph={card.provider.glyph || card.provider.label[0] || '?'} />
                        <span class="connection-card-text">
                          <span class="connection-card-title">{card.provider.label}</span>
                          <span class="connection-card-sub">{providerAsks(card.provider)}</span>
                          <Show when={limitText(card)}>{(text) => <span class="connection-card-state" data-full={card.full ? '' : undefined}>{text()}</span>}</Show>
                          <Show when={props.listedOn?.(card.provider)}>{(where) => <span class="connection-card-sub">{where()}</span>}</Show>
                        </span>
                      </span>
                    </Card>
                  )}
                </For>
              </div>
            </Show>
          </SettingsSection>
        }
      >
        {(provider) => (
          <SettingsSection
            id="steps"
            label={provider().connection.kind === 'device-flow' ? 'Sign in' : 'Credentials'}
            description={provider().connection.kind === 'device-flow'
              ? `${provider().label} shows a page where you enter a code from here.`
              : `acorn checks them with ${provider().label} before it keeps them.`}
          >
            <Show
              when={provider().connection.kind === 'device-flow'}
              fallback={
                <>
                  <For each={form.fields()}>
                    {(field) => (
                      <SettingRow label={field.label} description={field.hint} layout="stacked">
                        <Input
                          label={field.label}
                          type={field.type}
                          assist={false}
                          placeholder={field.placeholder}
                          value={form.value(field.id)}
                          onInput={(value) => form.setValue(field.id, value)}
                          onSubmit={() => void form.submit()}
                        />
                      </SettingRow>
                    )}
                  </For>
                  <Inline>
                    <Button variant="solid" tone="accent" busy={form.busy()} disabled={!form.complete()} onPress={() => void form.submit()}>Connect</Button>
                    <Button variant="ghost" onPress={backToGallery} disabled={form.busy()}>Cancel</Button>
                  </Inline>
                </>
              }
            >
              <Show
                when={deviceFlow.device()}
                fallback={
                  <Inline>
                    <Button onPress={() => void deviceFlow.start()} disabled={deviceFlow.busy()}>
                      {deviceFlow.busy() ? 'Starting…' : `Connect ${provider().label}`}
                    </Button>
                    <Button variant="ghost" onPress={backToGallery}>Cancel</Button>
                  </Inline>
                }
              >
                {(started) => (
                  <div class="integration-device">
                    <p class="integration-add-hint muted">Enter this code at the provider, then leave this page open.</p>
                    <div class="integration-device-code copyable">
                      <code>{started().userCode}</code>
                      <CopyButton text={() => started().userCode} title="Copy the code" />
                    </div>
                    {/* A real link, not a fetch: the shell opens it in the owner's browser. Safe under the
                        CSP because it is a navigation, not a frame or a connect-src. */}
                    <Show when={safeVerificationUrl(started().verificationUri)} fallback={<Alert>The provider returned an unsafe sign-in address. Cancel and retry.</Alert>}>
                      {(url) => <a class="ui-btn" href={url().href} target="_blank" rel="noopener noreferrer">Open {url().host}</a>}
                    </Show>
                    <p class="integration-add-hint muted">Waiting for approval…</p>
                    <Button variant="ghost" tone="danger" onPress={deviceFlow.cancel}>Cancel</Button>
                  </div>
                )}
              </Show>
            </Show>
            <Show when={form.error() || deviceFlow.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
          </SettingsSection>
        )}
      </Show>
    </>
  )
}
