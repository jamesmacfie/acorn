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
