// ponytail: ASCII acorn as a <pre>. Swap the art string for an inline SVG if we want a richer mark.
const ART = String.raw`
   ()
 .-''-.
/::::::\
'------'
|      |
 \    /
  \  /
   \/
`

export default function Acorn(props: { label?: string }) {
  return (
    <div class="acorn-empty">
      <pre class="acorn-art" aria-label="acorn">{ART}</pre>
      <span class="acorn-word">{props.label ?? 'acorn'}</span>
    </div>
  )
}
