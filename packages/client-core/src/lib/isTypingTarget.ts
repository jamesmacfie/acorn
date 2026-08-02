// Shared "is the user typing here?" guard for bare-key window shortcuts. Form fields,
// contentEditable surfaces, AND EditContext surfaces count — Monaco ≥0.53 attaches an EditContext
// to a plain focusable div (neither a form field nor contentEditable), so keystrokes into the SQL
// editor / notes pane must be detected via `el.editContext`. A bare-key shortcut must never fire
// while text entry owns the keystroke. Used by Shortcuts.tsx (global keys) and TaskView's pane keys.
export function isTypingTarget(t: EventTarget | null): boolean {
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || !!(t as HTMLElement & { editContext?: unknown }).editContext
}

// xterm focuses a hidden textarea, so the terminal reads as a typing target — but ⌘ chords are
// never terminal input on macOS (xterm leaves them to the browser), so chord shortcuts may fire
// there. Bare-key shortcuts must still stay off: those keystrokes ARE terminal input.
export function isTerminalTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('.terminal-surface')
}
