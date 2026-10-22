/** The address of a route of the app, for a link's `href`. The router adds the app's prefix to what it
 *  navigates to, and a plain `href` doesn't, so a link opened in a new tab would land outside the app. */
export const appHref = (path: string): string => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
