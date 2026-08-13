# Plugin DX Report Format

Render the review as a single HTML file in the OS temp directory. Tailwind and Mermaid load from CDNs; keep a small inline CSS fallback so the report remains readable if either CDN is unavailable.

The report explains each candidate from a **plugin author's point of view**:

> What must the author know or write today? What could move behind a deeper seam so the host does more and the plugin does less?

Use Mermaid for graph-shaped structure: registration flow, Hook order, lifecycle, host↔plugin sequences. Use HTML/CSS or inline SVG when the point is more editorial: author-code reduction, knowledge surface, responsibility transfer, or interface depth.

Do not force every candidate into the same diagram pattern. Pick the visual that makes the friction obvious.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Plugin DX review — {{repo name}}</title>

    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({
        startOnLoad: true,
        theme: "neutral",
        securityLevel: "loose"
      });
    </script>

    <style>
      /* Keep the report legible before Tailwind loads or if the CDN fails. */
      body {
        margin: 0;
        background: #fafaf9;
        color: #0f172a;
        font-family: system-ui, sans-serif;
      }

      main {
        max-width: 64rem;
        margin: 0 auto;
        padding: 3rem 1.5rem;
      }

      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); color: white; }

      /* Visual vocabulary for plugin DX. */
      .author { border-color: #6366f1; }
      .host { border-color: #94a3b8; }
      .implicit { border-style: dashed; }
      .friction { color: #dc2626; }
    </style>
  </head>

  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
