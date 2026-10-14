import { For, Show, createSignal } from 'solid-js'
import type { BridgeProject } from '@acorn/protocol/extensionBridge.ts'
import {
  associationMatches,
  parseSiteAddress,
  parseSiteAssociation,
  siteKind,
  siteText,
  type ProjectSite,
  type SiteAssociation,
  type SiteKind,
} from '@acorn/protocol/siteAssociations.ts'
import { Alert, Button, Field, Input, SegmentedControl, Select } from '@acorn/client-core/kit/components/primitives.tsx'
import { Modal } from '@acorn/client-core/kit/components/overlays'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'

const KINDS: readonly {
  value: SiteKind
  label: string
  hint: string
  placeholder: string
}[] = [
  {
    value: 'domain',
    label: 'Domain',
    hint: 'The domain and its subdomains, on any page.',
    placeholder: 'example.com',
  },
  {
    value: 'prefix',
    label: 'Starts with',
    hint: 'This address and every page under it.',
    placeholder: 'https://example.com/docs',
  },
  {
    value: 'exact',
    label: 'Exact page',
    hint: 'Only this page. Anything after ? or # is ignored.',
    placeholder: 'https://example.com/page',
  },
  {
    value: 'regex',
    label: 'Regex',
    hint: "A regular expression, tested against the page's whole address.",
    placeholder: '^https://example\\.com/(app|admin)/',
  },
]
const kindLabel = (site: SiteAssociation) => KINDS.find((kind) => kind.value === siteKind(site))!.label

// The page beside the sidebar, written as each kind would take it. A pattern starts empty.
function pageSuggestion(kind: SiteKind, pageUrl: string | undefined): string {
  const page = pageUrl ? parseSiteAddress(pageUrl) : null
  if (!page?.ok || kind === 'regex') return ''
  if (kind === 'domain') return new URL(page.site.origin).hostname
  return page.site.origin + (page.site.pathPrefix === '/' ? '' : page.site.pathPrefix)
}

// Every project's site associations on the Node: the pages the sidebar suggests each on. Separate from
// site access, which the browser grants and which these never widen. docs/browser-extension/project-sites.md.
export function ProjectSites(props: {
  client: BridgeClient
  nodeId: string
  projects: readonly BridgeProject[]
  sites: readonly ProjectSite[]
  // The project the dialog starts on: the current task's.
  projectId: string | null
  pageUrl: string | undefined
  online: boolean
  // The Node's list for that project after a change.
  changed(projectId: string, sites: SiteAssociation[]): void
}) {
  const [adding, setAdding] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  // Rejects with what to tell the person, for the dialog to show beside the fields.
  const change = async (op: 'site.add' | 'site.remove', projectId: string, site: SiteAssociation) => {
    setBusy(true)
    try {
      const result = await props.client.call({
        op,
        nodeId: props.nodeId,
        projectId,
        site,
      })
      props.changed(result.projectId, result.sites)
    } catch (error) {
      throw new Error(error instanceof CallFailure ? errorGuidance(error) : String(error))
    } finally {
      setBusy(false)
    }
  }
  const remove = (projectId: string, site: SiteAssociation) => {
    setProblem(null)
    change('site.remove', projectId, site).catch((error: Error) => setProblem(error.message))
  }

  return (
    <div class="sites">
      <div class="section-head">
        <p class="quiet">The panel suggests a project on these pages. They give Acorn no access to a site.</p>
        <button type="button" disabled={!props.online || !props.projects.length} onClick={() => setAdding(true)}>
          Add site
        </button>
      </div>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <For each={props.projects}>
        {(project) => {
          const sites = () => props.sites.filter((site) => site.projectId === project.id)
          return (
            <section aria-label={project.name}>
              <h3>{project.name}</h3>
              <Show when={sites().length} fallback={<p class="quiet">No sites yet.</p>}>
                <ul class="rows">
                  <For each={sites()}>
                    {({ projectId: _projectId, ...site }) => (
                      <li>
                        <div class="grow">
                          <span data-testid="project-site">{siteText(site)}</span>
                          <span class="quiet">{kindLabel(site)}</span>
                        </div>
                        <button
                          type="button"
                          class="quiet"
                          disabled={busy() || !props.online}
                          onClick={() => remove(project.id, site)}
                        >
                          Remove
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          )
        }}
      </For>
      <Show when={adding()}>
        <AddSite
          projects={props.projects}
          projectId={props.projectId}
          pageUrl={props.pageUrl}
          busy={busy()}
          add={(projectId, site) => change('site.add', projectId, site)}
          close={() => setAdding(false)}
        />
      </Show>
    </div>
  )
}

// The dialog behind Add site: which project, what kind of match, and the address or pattern, starting
// on the page beside the sidebar. It says what was typed wrong before anything goes to the Node.
function AddSite(props: {
  projects: readonly BridgeProject[]
  projectId: string | null
  pageUrl: string | undefined
  busy: boolean
  add(projectId: string, site: SiteAssociation): Promise<void>
  close(): void
}) {
  const [projectId, setProjectId] = createSignal(
    props.projects.some((project) => project.id === props.projectId) ? props.projectId! : props.projects[0]!.id,
  )
  const [kind, setKind] = createSignal<SiteKind>('domain')
  const [text, setText] = createSignal(pageSuggestion('domain', props.pageUrl))
  // Until the person types, the field follows the kind with the page's own address.
  const [typed, setTyped] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)
  const parsed = () => parseSiteAssociation(kind(), text())
  const details = () => KINDS.find((option) => option.value === kind())!
  const pageMatch = () => {
    const site = parsed()
    if (!props.pageUrl || !site.ok) return null
    return associationMatches(site.site, props.pageUrl) ? 'Covers this page.' : "Doesn't cover this page."
  }

  const chooseKind = (next: SiteKind) => {
    setKind(next)
    setProblem(null)
    if (!typed()) setText(pageSuggestion(next, props.pageUrl))
  }
  const submit = async () => {
    const site = parsed()
    if (!site.ok) return setProblem(site.reason)
    setProblem(null)
    try {
      await props.add(projectId(), site.site)
      props.close()
    } catch (error) {
      setProblem((error as Error).message)
    }
  }

  return (
    <Modal title="Add a site" size="sm" onDismiss={props.close}>
      <Modal.Body>
        <Field label="Project">
          <Select
            name="site-project"
            value={projectId()}
            onChange={setProjectId}
            options={props.projects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
          />
        </Field>
        <Field label="Match">
          <SegmentedControl options={KINDS} value={kind()} onChange={chooseKind} size="sm" ariaLabel="Match" />
        </Field>
        <Field
          label={kind() === 'regex' ? 'Pattern' : kind() === 'domain' ? 'Domain' : 'Address'}
          hint={details().hint}
        >
          <Input
            name="site"
            value={text()}
            placeholder={details().placeholder}
            onInput={(value) => {
              setTyped(true)
              setProblem(null)
              setText(value)
            }}
            onSubmit={() => void submit()}
          />
        </Field>
        <Show when={pageMatch()}>{(line) => <p class="quiet">{line()}</p>}</Show>
        <Show when={problem()}>{(message) => <Alert>{message()}</Alert>}</Show>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={props.close}>
          Cancel
        </Button>
        <Button variant="solid" busy={props.busy} disabled={!text().trim()} onPress={() => void submit()}>
          Add site
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
