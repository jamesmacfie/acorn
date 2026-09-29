// Anything that is not this document is somebody else's site, and a link to one opens away from the
// app with the opener severed. Derived rather than asked for, so no call site can forget the `rel`.
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i
export const isExternal = (href: string) => EXTERNAL.test(href) && !href.startsWith('#')
