// Expressive Code, which draws the site's code blocks. Its options live here, not in astro.config.mjs,
// because Starlight's <Code> component can only read options it can serialize, and themeCssSelector
// is a function.
import { defineEcConfig } from '@astrojs/starlight/expressive-code'

export default defineEcConfig({
  // The two Shiki themes the app loads (packages/client-core/src/infra/highlight/shiki.ts), so code on the
  // site matches code in acorn. AppearanceScript sets `data-color-scheme` from the theme, so a dark theme
  // draws github-dark.
  themes: ['github-dark', 'github-light'],
  themeCssSelector: (theme) => `[data-color-scheme='${theme.type}']`,
  useDarkModeMediaQuery: false,
  // The frame of the app's `CodeBlock`: a sunken surface inside the control border.
  styleOverrides: {
    borderColor: 'var(--border-strong)',
    borderRadius: 'var(--radius-surface)',
    codeBackground: 'var(--surface-sunken)',
    codeFontFamily: 'var(--font-mono)',
    codeFontSize: 'var(--fs-md)',
    codeLineHeight: 'var(--lh)',
    uiFontFamily: 'var(--font-ui)',
    uiFontSize: 'var(--fs-sm)',
    frames: {
      editorTabBarBackground: 'var(--bg-subtle)',
      editorActiveTabBackground: 'var(--bg-subtle)',
      editorActiveTabForeground: 'var(--text)',
      editorActiveTabIndicatorBottomColor: 'var(--accent)',
      editorActiveTabIndicatorTopColor: 'transparent',
      editorTabBarBorderBottomColor: 'var(--border)',
      terminalTitlebarBackground: 'var(--bg-subtle)',
      terminalTitlebarForeground: 'var(--text)',
      terminalTitlebarBorderBottomColor: 'var(--border)',
      terminalTitlebarDotsForeground: 'var(--border-strong)',
      terminalBackground: 'var(--surface-sunken)',
      frameBoxShadowCssValue: 'none',
      inlineButtonForeground: 'var(--text)',
      inlineButtonBorder: 'var(--border-strong)',
      inlineButtonBackground: 'var(--bg)',
      tooltipSuccessBackground: 'var(--text)',
      tooltipSuccessForeground: 'var(--bg)',
    },
  },
})
