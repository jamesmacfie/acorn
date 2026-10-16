// What every specimen exports beside its component. The generators copy it into `<id>.tree.json`, so
// the site reads it from there and never imports a specimen's source.
export type SpecimenMeta = {
  title: string
  caption: string
  /** The terminal frame, in cells. */
  terminal: { columns: number; rows: number }
  /** The desktop frame's width, in pixels. */
  width: number
}
