// One sanitiser for the two places a session hands the owner a file: an artifact card and a
// transcript export. Both build a name out of text somebody typed, and a save dialog wants something
// a filesystem will take, so everything outside the safe set collapses to a hyphen.
//
// The caller supplies the limit because the two names have different room: an artifact title carries
// more of itself than a session title needs to.
export const downloadName = (text: string, limit: number): string =>
  text.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, limit)
