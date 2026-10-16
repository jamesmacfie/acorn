// Copy buttons: a `[data-copy]` button copies the text of the element its value names, then says
// "Copied" for two seconds. A button is hidden in the markup and shown here, so a page without script
// never offers a button that does nothing.
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  const label = button.textContent
  let restore: ReturnType<typeof setTimeout> | undefined
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById(button.dataset.copy!)!.textContent ?? '')
    button.textContent = 'Copied'
    clearTimeout(restore)
    restore = setTimeout(() => (button.textContent = label), 2000)
  })
  button.hidden = false
}
