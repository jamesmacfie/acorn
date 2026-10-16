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

/** The acorn alone, for an empty state's icon, where the title under it names the screen. */
export function AcornArt() {
  return (
    <pre class="acorn-art" aria-hidden="true">
      {ART}
    </pre>
  )
}

export default function Acorn(props: { label?: string }) {
  return (
    <div class="acorn-empty">
      <pre class="acorn-art" aria-label="acorn">
        {ART}
      </pre>
      <span class="acorn-word">{props.label ?? 'acorn'}</span>
    </div>
  )
}
