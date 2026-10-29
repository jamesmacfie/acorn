// The oak sprig on a stage (Hero.astro): a twig with leaves and acorns, drawn in mono glyphs on a grid
// behind the hero's words. The twig and the leaves' midribs are lines of slashes and dashes, a branch
// name from the site's fixture runs along the twig, the blades are a stipple, and the acorns are shaded
// in brass. The field fades near the words, so they stay clear. A pointer that brushes the sprig sets it
// swaying until it settles. Without script the canvas stays empty. Under reduced motion the sprig draws
// once and holds still.

// One cell is one character of JetBrains Mono, whose advance is 0.6 of its size.
const CELL_W = 6
const CELL_H = 12
const FONT_PX = CELL_W / 0.6

const NUT_GLYPHS = '.:oO0@'
const CAP_GLYPHS = '.:x%#'

// The sprig at full size, in pixels from its anchor at the stage's top right: the window's right edge,
// or on a screen much wider than the page, a little past the page's column. The twig is a curve from
// `from` through `via` to `to`. Each part hangs `at` a fraction of the way along it, points `angle`
// degrees clockwise from pointing right, and is `size` long, or for an acorn, `size` tall.
type Point = [number, number]
type Part = { kind: 'leaf' | 'acorn'; at: number; angle: number; size: number }
type Sprig = { twig: { from: Point; via: Point; to: Point }; parts: Part[] }

const SPRIGS = {
  // A split hero, the landing page's: the twig runs above the paragraph, its tip leaf lies above the
  // headline, and the acorns hang in the gap between the two.
  split: {
    twig: { from: [30, 24], via: [-360, 4], to: [-800, 64] },
    parts: [
      { kind: 'leaf', at: 0.06, angle: 100, size: 230 },
      { kind: 'leaf', at: 0.3, angle: 150, size: 180 },
      { kind: 'leaf', at: 0.55, angle: 200, size: 170 },
      { kind: 'acorn', at: 0.83, angle: 92, size: 130 },
      { kind: 'acorn', at: 0.96, angle: 84, size: 112 },
      { kind: 'leaf', at: 1, angle: 196, size: 190 },
    ],
  },
  // Every other hero, whose words keep to the left: a shorter sprig across the top right.
  aside: {
    twig: { from: [30, 30], via: [-300, 60], to: [-640, 40] },
    parts: [
      { kind: 'leaf', at: 0.08, angle: 98, size: 220 },
      { kind: 'leaf', at: 0.35, angle: 205, size: 160 },
      { kind: 'acorn', at: 0.5, angle: 90, size: 130 },
      { kind: 'leaf', at: 0.66, angle: 125, size: 170 },
      { kind: 'acorn', at: 0.82, angle: 78, size: 112 },
      { kind: 'leaf', at: 1, angle: 180, size: 170 },
    ],
  },
} satisfies Record<string, Sprig>

// The fixture's task branches. The split hero's window shows the first task, so its twig names it.
const BRANCHES = ['retry-failed-webhooks', 'add-eu-vat', 'speed-up-the-overdue-invoices-query']

type Cell = { glyph: string; tone: 'cool' | 'warm'; level: number }
type Motion = { angle: number; spin: number }

const reduced = matchMedia('(prefers-reduced-motion: reduce)')

for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas.glyph-field')) {
  void document.fonts.ready.then(() => plant(canvas))
}

/** The line glyph for a stroke heading `dx`, `dy` on the screen. */
function slant(dx: number, dy: number) {
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180
  return angle < 22.5 || angle >= 157.5 ? '-' : angle < 67.5 ? '\\' : angle < 112.5 ? '|' : '/'
}

/** An oak leaf's edge at `t` along its midrib, as an offset from the midrib: three rounded lobes a
 *  side between deep notches, widest past the middle, closing to the stalk and a round tip. */
function leafEdge(length: number, t: number, side: 1 | -1) {
  const body = Math.sin(Math.PI * Math.min(1, t ** 0.85)) ** 0.6
  const lobes = 0.4 + 0.6 * Math.abs(Math.sin(3.2 * Math.PI * t + (side > 0 ? 0.2 : 0.7)))
  return side * length * 0.3 * body * lobes * Math.min(1, t * 6)
}

/** A sprig like `sprig`, each part turned and sized a little differently for `seed`. */
function grow(sprig: Sprig, seed: number): Sprig {
  // Mulberry32: a small generator that gives the same numbers for the same seed.
  let state = seed
  const random = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const [x, y] = sprig.twig.via
  return {
    twig: { ...sprig.twig, via: [x, y + (random() - 0.5) * 40] },
    parts: sprig.parts.map((part) => ({
      ...part,
      angle: part.angle + (random() - 0.5) * 18,
      size: part.size * (0.9 + random() * 0.2),
    })),
  }
}

function plant(canvas: HTMLCanvasElement) {
  const stage = canvas.parentElement!
  const seed = Number(canvas.dataset.seed ?? 0)
  const split = canvas.dataset.sprig === 'split'
  const sprig = split ? SPRIGS.split : grow(SPRIGS.aside, seed)
  const branch = split ? BRANCHES[0] : BRANCHES[seed % BRANCHES.length]
  const context = canvas.getContext('2d')!
  // The shapes are first drawn on a grid with one pixel per cell, so each cell's coverage reads straight
  // off it: red for a leaf's blade, green for a nut, blue for a cap.
  const raster = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const motions = sprig.parts.map((): Motion => ({ angle: 0, spin: 0 }))

  const style = getComputedStyle(canvas)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const tones = {
    cool: [1, 2, 3, 4].map((step) => token(`--site-glyph-${step}`)),
    warm: [1, 2, 3].map((step) => token(`--site-glyph-warm-${step}`)),
  }
  const font = `${FONT_PX}px ${token('--font-mono')}`

  let width = 0
  let height = 0
  let columns = 0
  let rows = 0
  let scale = 1
  let anchor = 0
  let clear: DOMRect[] = []
  let pointer: Point | undefined
  let born = 0
  let frame = 0
  let last = 0

  // The canvas runs from the window's left edge to its right, so the twig can come in from beyond the
  // page's column, and covers the stage from the header down.
  const measure = () => {
    const box = stage.getBoundingClientRect()
    width = document.documentElement.clientWidth
    height = stage.offsetHeight
    canvas.style.insetInlineStart = `${-box.left}px`
    canvas.style.inlineSize = `${width}px`
    canvas.style.blockSize = `${height}px`
    const ratio = devicePixelRatio
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    columns = Math.ceil(width / CELL_W)
    rows = Math.ceil(height / CELL_H)
    raster.canvas.width = columns
    raster.canvas.height = rows
    scale = Math.min(1, width / 1440)
    anchor = Math.min(width, box.right + 152 * scale)
    // The lines of the words themselves, which the field fades away from. The canvas starts at the
    // window's left edge and the stage's top.
    clear = [...stage.children]
      .filter((child) => child !== canvas && !child.classList.contains('hero-picture'))
      .flatMap((child) => {
        const range = document.createRange()
        range.selectNodeContents(child)
        return [...range.getClientRects()].map(
          (rect) => new DOMRect(rect.left, rect.top - box.top, rect.width, rect.height),
        )
      })
  }

  /** A design point, from the anchor, in canvas pixels. */
  const place = ([x, y]: Point): Point => [anchor + x * scale, y * scale]

  const along = (t: number): Point => {
    const { from, via, to } = sprig.twig
    const point = (axis: 0 | 1) => (1 - t) ** 2 * from[axis] + 2 * (1 - t) * t * via[axis] + t ** 2 * to[axis]
    return place([point(0), point(1)])
  }

  /** Writes a line through `points` into `cells`, a glyph per cell for the line's direction there.
   *  `level` is how bright it draws, and a brighter line wins a cell from a fainter one. */
  const stroke = (cells: Map<number, Cell>, points: Point[], level: number) => {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1]
      const [x1, y1] = points[i]
      const glyph = slant(x1 - x0, y1 - y0)
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0) / CELL_W, Math.abs(y1 - y0) / CELL_H) * 2) || 1
      for (let step = 0; step <= steps; step++) {
        const column = Math.floor((x0 + ((x1 - x0) * step) / steps) / CELL_W)
        const row = Math.floor((y0 + ((y1 - y0) * step) / steps) / CELL_H)
        if (column < 0 || column >= columns || row < 0 || row >= rows) continue
        const key = row * columns + column
        if ((cells.get(key)?.level ?? -1) < level) cells.set(key, { glyph, tone: 'cool', level })
      }
    }
  }

  /** The twig, and the branch name over the run of its cells that climbs or falls least, so the name
   *  reads on one row. The name goes on last, over anything else in its cells. */
  const twig = (cells: Map<number, Cell>) => {
    const line = new Map<number, Cell>()
    // Where the anchor stops short of the window's edge, the twig runs straight on out to it.
    const [, enters] = along(0)
    stroke(line, [[width + CELL_W, enters], ...Array.from({ length: 61 }, (_, step) => along(step / 60))], 1.6)
    const flat = [...line.keys()]
      .map((key) => [key % columns, Math.floor(key / columns)])
      .sort(([a], [b]) => a - b)
      .filter(([column], index, all) => index === 0 || column !== all[index - 1][0])
    let start = 0
    let drift = Infinity
    for (let at = 0; at + branch.length <= flat.length; at++) {
      const run = flat.slice(at, at + branch.length).map(([, row]) => row)
      const spread = Math.max(...run) - Math.min(...run)
      if (spread < drift) [start, drift] = [at, spread]
    }
    const run = flat.slice(start, start + branch.length)
    const row = run[branch.length >> 1]?.[1] ?? 0
    for (const [key, cell] of line) {
      const column = key % columns
      if (run.length === branch.length && column >= run[0][0] && column <= run[run.length - 1][0]) continue
      if ((cells.get(key)?.level ?? -1) < cell.level) cells.set(key, cell)
    }
    if (run.length === branch.length) {
      run.forEach(([column], index) =>
        cells.set(row * columns + column, { glyph: branch[index], tone: 'cool', level: 2.4 }),
      )
    }
  }

  /** A leaf's midrib, a step brighter than its blade. */
  const midrib = (cells: Map<number, Cell>, part: Part, turn: number) => {
    const [ox, oy] = along(part.at)
    const reach = part.size * 0.92 * scale
    stroke(
      cells,
      [
        [ox, oy],
        [ox + Math.cos(turn) * reach, oy + Math.sin(turn) * reach],
      ],
      2.1,
    )
  }

  const drawLeaf = (length: number) => {
    raster.fillStyle = 'rgb(255 0 0)'
    raster.beginPath()
    raster.moveTo(0, 0)
    for (let i = 1; i <= 80; i++) raster.lineTo((i / 80) * length, leafEdge(length, i / 80, 1))
    for (let i = 80; i >= 0; i--) raster.lineTo((i / 80) * length, leafEdge(length, i / 80, -1))
    raster.fill()
  }

  const drawAcorn = (size: number) => {
    raster.fillStyle = 'rgb(0 0 230)'
    raster.fillRect(-2.5, 0, 5, size * 0.18)
    // The nut is an egg narrowing to a point, lit from the top left.
    const nut = raster.createRadialGradient(-size * 0.1, size * 0.48, size * 0.04, 0, size * 0.6, size * 0.42)
    nut.addColorStop(0, 'rgb(0 255 0)')
    nut.addColorStop(1, 'rgb(0 110 0)')
    raster.fillStyle = nut
    raster.beginPath()
    raster.moveTo(-size * 0.29, size * 0.42)
    raster.bezierCurveTo(-size * 0.32, size * 0.78, -size * 0.12, size * 0.92, 0, size * 1.02)
    raster.bezierCurveTo(size * 0.12, size * 0.92, size * 0.32, size * 0.78, size * 0.29, size * 0.42)
    raster.fill()
    raster.fillStyle = 'rgb(0 0 255)'
    raster.beginPath()
    raster.ellipse(0, size * 0.38, size * 0.35, size * 0.2, 0, Math.PI, 0)
    raster.ellipse(0, size * 0.38, size * 0.35, size * 0.07, 0, 0, Math.PI)
    raster.fill()
  }

  /** The leaves' blades and the acorns, drawn as shapes and read back a cell at a time: a blade is a
   *  stipple, a cap is scales, and a nut is shaded by the light falling across it. */
  const shade = (cells: Map<number, Cell>) => {
    raster.setTransform(1, 0, 0, 1, 0, 0)
    raster.globalCompositeOperation = 'source-over'
    raster.clearRect(0, 0, columns, rows)
    raster.globalCompositeOperation = 'lighter'
    sprig.parts.forEach((part, index) => {
      const [x, y] = along(part.at)
      raster.setTransform(scale / CELL_W, 0, 0, scale / CELL_H, x / CELL_W, y / CELL_H)
      const turn = (part.angle * Math.PI) / 180 + motions[index].angle
      // An acorn hangs down from its stalk, so its angle turns it from straight down.
      if (part.kind === 'leaf') {
        raster.rotate(turn)
        drawLeaf(part.size)
      } else {
        raster.rotate(turn - Math.PI / 2)
        drawAcorn(part.size)
      }
    })
    const data = raster.getImageData(0, 0, columns, rows).data
    for (let key = 0; key < columns * rows; key++) {
      const [blade, nut, cap] = [data[key * 4] / 255, data[key * 4 + 1] / 255, data[key * 4 + 2] / 255]
      if (cap > 0.2) {
        const level = Math.min(CAP_GLYPHS.length - 1, Math.floor(cap * CAP_GLYPHS.length))
        const scales = (key % columns) + Math.floor(key / columns)
        cells.set(key, {
          glyph: level >= 3 ? (scales % 2 ? '#' : '%') : CAP_GLYPHS[level],
          tone: 'warm',
          level: cap * 0.95,
        })
      } else if (nut > 0.2) {
        cells.set(key, {
          glyph: NUT_GLYPHS[Math.min(NUT_GLYPHS.length - 1, Math.floor(nut * NUT_GLYPHS.length))],
          tone: 'warm',
          level: nut * 1.6,
        })
      } else if (blade > 0.3) {
        cells.set(key, { glyph: blade > 0.7 ? ':' : '.', tone: 'cool', level: 1.1 })
      }
    }
  }

  const draw = (now: number) => {
    // A phone's stage hides the field, so there's nothing to draw.
    if (!canvas.offsetWidth) return
    const cells = new Map<number, Cell>()
    shade(cells)
    sprig.parts.forEach((part, index) => {
      if (part.kind === 'leaf') midrib(cells, part, (part.angle * Math.PI) / 180 + motions[index].angle)
    })
    twig(cells)

    const age = reduced.matches ? Infinity : now - born
    context.clearRect(0, 0, width, height)
    context.font = font
    context.textBaseline = 'top'
    const [px, py] = pointer ?? [-1e4, -1e4]
    for (const [key, cell] of cells) {
      const column = key % columns
      const row = Math.floor(key / columns)
      // Cells come in from where the twig enters, over a second and a half.
      if (age < ((columns - column) * 3 + row * 2) * (1500 / (columns * 3 + rows * 2))) continue
      const x = column * CELL_W
      const y = row * CELL_H
      // A third of the light on the words themselves, rising to all of it 32 pixels away, and more
      // where the pointer is.
      let near = Infinity
      for (const rect of clear) {
        near = Math.min(
          near,
          Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom)),
        )
      }
      const light =
        (0.3 + 0.7 * Math.min(1, near / 32)) * cell.level + Math.max(0, 1 - Math.hypot((x - px) / 1.4, y - py) / 120)
      if (light < 0.25) continue
      const ramp = tones[cell.tone]
      context.fillStyle = ramp[Math.min(ramp.length - 1, Math.floor(light))]
      context.fillText(cell.glyph, x, y)
    }
  }

  // A part swings on a spring and comes to rest in about two seconds.
  const settle = (seconds: number) => {
    let moving = false
    for (const motion of motions) {
      motion.spin += (-motion.angle * 26 - motion.spin * 3.2) * seconds
      motion.angle += motion.spin * seconds
      if (Math.abs(motion.angle) > 0.002 || Math.abs(motion.spin) > 0.002) moving = true
      else motion.angle = motion.spin = 0
    }
    return moving
  }

  const tick = (now: number) => {
    const seconds = Math.min(0.05, (now - last) / 1000)
    last = now
    const moving = settle(seconds)
    draw(now)
    frame = moving || now - born < 1600 ? requestAnimationFrame(tick) : 0
  }

  const wake = () => {
    if (frame || reduced.matches) return
    last = performance.now()
    frame = requestAnimationFrame(tick)
  }

  measure()
  born = performance.now()
  if (reduced.matches) draw(born)
  else wake()

  stage.addEventListener('pointermove', (event) => {
    if (reduced.matches) return
    const box = canvas.getBoundingClientRect()
    const next: Point = [event.clientX - box.left, event.clientY - box.top]
    // The pointer's sideways speed pushes every part it passes close to.
    if (pointer) {
      const push = (next[0] - pointer[0]) / 40
      sprig.parts.forEach((part, index) => {
        const [x, y] = along(part.at)
        const reach = part.size * scale * 1.1
        const distance = Math.hypot(next[0] - x, next[1] - y)
        if (distance < reach) motions[index].spin += push * (1 - distance / reach)
      })
    }
    pointer = next
    wake()
  })
  stage.addEventListener('pointerleave', () => {
    pointer = undefined
    wake()
  })
  // The window can widen while the stage, capped at the page's width, keeps its size, so both are
  // watched.
  const resized = new ResizeObserver(() => {
    measure()
    if (reduced.matches || !frame) draw(performance.now())
  })
  resized.observe(stage)
  resized.observe(document.documentElement)
}
