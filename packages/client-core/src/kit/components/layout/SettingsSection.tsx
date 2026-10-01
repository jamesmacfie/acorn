import { children, createUniqueId, Show, type JSX } from 'solid-js'
import { HelpMark } from '../content/HelpMark'

export type SettingsSectionProps = {
  /** The anchor a deep link and a search result land on, `settings/<page>#<id>`. It matches an entry in
   *  the page's declared `sections`, which is how search finds it without reading the page. */
  id: string
  label: string
  description?: string
  /** How the section works or why it is there, behind a "?" after the label. */
  help?: string
  /** Controls about the whole section, beside its label. An element, so only a compiled page can pass
   *  one; a remote tree puts its buttons in a row instead. */
  actions?: JSX.Element
  /** `danger` is the danger zone: the box at the foot of a page that holds delete, uninstall, unpair
   *  and revoke. */
  tone?: 'danger'
  children?: JSX.Element
}

/* SettingsSection: one titled group of setting rows on a settings page (docs/frontend.md § Settings).

   The anchor is a data attribute rather than an element id, because two pages can each declare a
   section called `general` and a document holds one element per id. The settings view looks for it
   inside the page it drew.

   At 80×24: the label in bold, the description and the help in grey under it, then the rows. */
export function SettingsSection(props: SettingsSectionProps) {
  const labelId = createUniqueId()
  const actions = children(() => props.actions)
  return (
    <section class="ui-settings-section" data-settings-section={props.id} data-tone={props.tone} aria-labelledby={labelId}>
      <div class="ui-settings-section-head">
        <Show when={props.help} fallback={<h2 class="ui-settings-section-label" id={labelId}>{props.label}</h2>}>
          {(help) => (
            <span class="ui-titled">
              <h2 class="ui-settings-section-label" id={labelId}>{props.label}</h2>
              <HelpMark text={help()} titleId={labelId} />
            </span>
          )}
        </Show>
        <Show when={actions()}><span class="ui-settings-section-actions">{actions()}</span></Show>
      </div>
      <Show when={props.description}><p class="ui-settings-section-description">{props.description}</p></Show>
      <div class="ui-settings-section-rows">{props.children}</div>
    </section>
  )
}
