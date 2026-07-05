// Shared "is the user typing here?" guard for bare-key window shortcuts. Form fields AND
// contentEditable surfaces (Monaco, the notes pane) count — a bare-key shortcut must never fire
// while text entry owns the keystroke. Used by Shortcuts.tsx (global keys) and TaskView's pane keys.
export function isTypingTarget(t: EventTarget | null): boolean {
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true
  return t instanceof HTMLElement && t.isContentEditable
}

// xterm focuses a hidden textarea, so the terminal reads as a typing target — but ⌘ chords are
// never terminal input on macOS (xterm leaves them to the browser), so chord shortcuts may fire
// there. Bare-key shortcuts must still stay off: those keystrokes ARE terminal input.
export function isTerminalTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('.terminal-surface')
}
