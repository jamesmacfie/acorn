// Bare three-pane skeleton (docs/ui-style.md §5). Real components fill these panes later.
export default function App() {
  return (
    <div class="app">
      <header class="topbar">
        <span class="muted">gurthurd</span>
        <span class="muted">PR review</span>
        <span class="muted" aria-hidden="true">◐</span>
      </header>
      <main class="panes">
        <section class="pane pane-left">
          <div class="section-header">Reviews</div>
          <p class="placeholder">PR list — coming soon.</p>
        </section>
        <section class="pane pane-mid">
          <div class="section-header">Navigator</div>
          <p class="placeholder">Select a PR.</p>
        </section>
        <section class="pane pane-right">
          <div class="section-header">Diff</div>
          <p class="placeholder">Nothing here.</p>
        </section>
      </main>
    </div>
  )
}
