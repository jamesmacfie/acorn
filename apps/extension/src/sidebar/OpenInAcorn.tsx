import { Show, createSignal } from 'solid-js'

// Opens the desktop app on `href`, as a plain link, which both browsers hand to the app that
// registered the scheme. Only a release desktop registers `acorn://`, so a development build copies
// the link instead. `label` names where the link goes, when that is more than the app.
export function OpenInAcorn(props: { href: string | null; opensLinks: boolean; class?: string; label?: string }) {
  return (
    <Show when={props.href}>
      {(href) => (
        <Show when={props.opensLinks} fallback={<CopyAcornLink href={href()} class={props.class} />}>
          <a class={`button ${props.class ?? ''}`} href={href()}>
            {props.label ?? 'Open in Acorn'} ↗
          </a>
        </Show>
      )}
    </Show>
  )
}

function CopyAcornLink(props: { href: string; class?: string }) {
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    await navigator.clipboard.writeText(props.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button type="button" class={props.class} title={props.href} onClick={() => void copy().catch(() => {})}>
      {copied() ? 'Copied' : 'Copy Acorn link'}
    </button>
  )
}
