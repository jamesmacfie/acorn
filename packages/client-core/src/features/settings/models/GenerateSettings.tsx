import { createMemo, Index, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import Icon from '../../../kit/components/content/Icon'
import { brandStyle } from '../../../kit/tokens/brandMarks'
import { modelBackendsOptions, prefsOptions } from '../../../infra/queries'
import ModelBackendPicker from './ModelBackendPicker'
import { effectiveModelPick, readGeneratePick, saveGeneratePick } from './generatePick'

// Settings → Integrations → Generating text: what this owner can generate with, and which of it a
// Generate control reaches for by default.
//
// Drawn from the backends route rather than counted off the integrations list beside it, because half
// the answer is a question only the node can ask — whether an agent CLI is on PATH — and it asks it
// per read, so a CLI installed while acorn is open shows up on the next look.
//
// No toggles. A backend the owner does not want is one they do not pick, and connections come first
// in the list, so every silent path keeps spending a key the owner configured on purpose. A switch
// here would be a setting whose only job is to hide a row.
//
// A row is a mark, a label, and a kind. No version, though the plan called for one: the version
// `which` found lives on the agents plugin's provider descriptor, served by that plugin's own route,
// and core may neither import a plugin nor fetch a plugin's path. It waits for a client capability
// that plugin publishes.

/** What a row says under the label. The kind, in the two words a reader of this page needs: a stored
 *  credential, or a program on this machine. */
const kindOf = (backend: ModelBackend): string => (backend.kind === 'harness' ? 'Installed' : 'API key')

/** The branded square the connection cards above wear, for a backend that named a mark. Absent is the
 *  common case for a CLI, and an empty square is worse than none. */
function BackendLogo(props: { glyph: string }) {
  return (
    <span class="integration-logo" style={brandStyle(props.glyph)}>
      <span class="integration-logo-mono"><Icon name={props.glyph} /></span>
    </span>
  )
}

export default function GenerateSettings() {
  const qc = useQueryClient()
  const status = createQuery(() => modelBackendsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const backends = () => status.data?.backends ?? []
  // A memo, not a getter: the picker reads both halves of it, and a getter would redo the resolution
  // on every unrelated prefs tick.
  const pick = createMemo(() => effectiveModelPick(backends(), readGeneratePick(prefs.data)))
  // Every harness that offered a one-shot mode and is not installed here. Quietly, as a row that says
  // so — not an error. Nothing is broken; a program is simply not on this machine.
  const missing = () => status.data?.missing ?? []

  return (
    <div class="settings-subsection">
      <h3 class="settings-section-label">Generating text</h3>
      <p class="integration-add-hint muted">
        Commit messages, SQL, and workflows are written by whichever of these you pick. A key is
        spent from the node. An installed agent signs in on its own, and acorn never passes it a key.
      </p>
      <Show
        when={backends().length || missing().length}
        fallback={
          <p class="integration-add-hint muted">
            Nothing to generate with. Add a provider key above, or install an agent CLI.
          </p>
        }
      >
        <div class="settings-field">
          {/* The one place the default is changed outside a dialog. The picker hides its backend
              select when there is a single choice, which is right here too: there is no choice to
              make, and the model select below it still is one. */}
          <ModelBackendPicker
            backends={backends()}
            backendId={pick()?.backendId ?? ''}
            modelId={pick()?.modelId ?? ''}
            onChange={(next) => void saveGeneratePick(qc, next)}
          />
        </div>
        <div class="integrations-list">
          {/* `Index` rather than `For`: the route refetches on a short stale time, so every row would
              be a new object each time and a rebuilt row loses focus under the reader's hands. */}
          <Index each={backends()}>
            {(backend) => (
              <div class="integration-card">
                <Show when={backend().glyph}>{(glyph) => <BackendLogo glyph={glyph()} />}</Show>
                <div class="integration-meta">
                  <span class="integration-title">{backend().label}</span>
                  <span class="integration-sub">{kindOf(backend())}</span>
                </div>
              </div>
            )}
          </Index>
          <Index each={missing()}>
            {(harness) => (
              <div class="integration-card">
                <div class="integration-meta">
                  <span class="integration-title">{harness().label}</span>
                  <span class="integration-sub">Not found on this machine</span>
                </div>
              </div>
            )}
          </Index>
        </div>
      </Show>
    </div>
  )
}
