// Shared "is the user typing here?" guard for bare-key window shortcuts. Form fields AND
// contentEditable surfaces (Monaco, the notes pane) count — a bare-key shortcut must never fire
// while text entry owns the keystroke. Used by Shortcuts.tsx (global keys) and TaskView's pane keys.
export function isTypingTarget(t: EventTarget | null): boolean {
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true
  return t instanceof HTMLElement && t.isContentEditable
}
