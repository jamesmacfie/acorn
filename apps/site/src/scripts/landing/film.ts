// The landing page's motion (docs/site/design/motion.md). The page is whole without this file: it adds
// `live` to <html> when the visitor allows motion, and `film` when the window is also big enough to pin
// a scene, and src/styles/landing.css keeps every moving rule under one of the two. A scene carries
// `--p`, how far the scroll has taken it from 0 to 1, and its styles work the rest out from that.
const root = document.documentElement
const motion = matchMedia('(prefers-reduced-motion: no-preference)')
const roomy = matchMedia('(min-width: 60rem) and (min-height: 36rem)')
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const all = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)]

/** Runs `enter` the first time each element comes within a screen of the window. */
function onApproach(elements: HTMLElement[], enter: (element: HTMLElement) => void, rootMargin = '0px') {
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        watch.unobserve(entry.target)
        enter(entry.target as HTMLElement)
      }
    },
    { rootMargin },
  )
  elements.forEach((element) => watch.observe(element))
}

// ── Scenes ──
// Where the browser has scroll timelines, the compositor plays each scene's moves (landing.css § Moves)
// and this only marks the rail. Elsewhere it sets `--p` on each scene, which holds the moves at that
// point. A pinned scene is taller than the window and holds a sticky stage, so its progress is how much
// of that extra height has scrolled by. Any other scene's is its trip from the window's foot to its top.
const scenes = CSS.supports('animation-timeline: view()') ? [] : all('[data-scene]')
const chapters = all<HTMLAnchorElement>('.rail a').map((link) => ({
  link,
  top: document.getElementById(link.hash.slice(1))!,
}))
let current: HTMLAnchorElement | undefined
let queued = false

function frame() {
  queued = false
  const screen = innerHeight
  // Every scene is measured before any is written, so the browser lays the page out once.
  const boxes = scenes.map((scene) => scene.getBoundingClientRect())
  scenes.forEach((scene, index) => {
    const { top, height } = boxes[index]
    // A scene more than a screen away keeps the value it left with.
    if (top > 2 * screen || top + height < -screen) return
    const progress = scene.dataset.scene === 'pin' ? -top / (height - screen) : (screen - top) / (screen + height)
    scene.style.setProperty('--p', clamp(progress).toFixed(4))
  })
  const reached = chapters.findLast(({ top }) => top.getBoundingClientRect().top < screen / 2)?.link
  if (reached === current) return
  current?.removeAttribute('aria-current')
  reached?.setAttribute('aria-current', 'true')
  current = reached
}
const queue = () => {
  if (!queued) requestAnimationFrame(frame)
  queued = true
}
function mode() {
  root.classList.toggle('live', motion.matches)
  root.classList.toggle('film', motion.matches && roomy.matches)
  queue()
}
motion.addEventListener('change', mode)
roomy.addEventListener('change', mode)
addEventListener('scroll', queue, { passive: true })
addEventListener('resize', queue)
mode()

// ── Blocks that rise in ──
onApproach(all('[data-reveal]'), (block) => block.classList.add('seen'), '0px 0px -10% 0px')

// ── The headline ──
// Each letter of the last words takes its own width from the face's width axis. The widths swell
// around one point, which follows the pointer and wanders on its own when the pointer rests, and they
// always average the same, so the words keep their length while the letters squash and stretch.
const kinetic = document.querySelector<HTMLElement>('[data-kinetic]')
if (kinetic) {
  const letters = [...kinetic.children] as HTMLElement[]
  // The face's axis stops at 150, and the swell's own mean is about a third, so this swing peaks there.
  const [REST, SWING, SPREAD] = [96, 80, 0.035]
  let aim = 0.5
  let at = 0.5
  let moved = -Infinity
  let showing = false
  let running = false
  // In the film the words have faded by 14% of the opening's scroll (landing.css, open-leave), though
  // they're still in the window. Moving letters under the header's blur cost a whole frame each.
  const scene = kinetic.closest<HTMLElement>('[data-scene]')!
  const faded = () =>
    root.classList.contains('film') && -scene.getBoundingClientRect().top > 0.14 * (scene.offsetHeight - innerHeight)
  const draw = (now: number) => {
    running = showing && motion.matches && !faded()
    if (!running) return
    if (now - moved > 2500) aim = 0.5 + 0.48 * Math.sin(now / 900)
    at += (aim - at) * 0.1
    const swell = letters.map((_, index) => Math.exp(-(((index + 0.5) / letters.length - at) ** 2) / SPREAD))
    const mean = swell.reduce((sum, value) => sum + value) / swell.length
    letters.forEach((letter, index) =>
      letter.style.setProperty('--w', (REST + SWING * (swell[index] - mean)).toFixed(1)),
    )
    requestAnimationFrame(draw)
  }
  const wake = () => {
    if (running || !showing) return
    running = true
    requestAnimationFrame(draw)
  }
  addEventListener('pointermove', (event) => {
    const { left, width } = kinetic.getBoundingClientRect()
    aim = clamp((event.clientX - left) / width)
    moved = performance.now()
  })
  addEventListener('scroll', wake, { passive: true })
  new IntersectionObserver(([entry]) => {
    showing = entry.isIntersecting
    wake()
  }).observe(kinetic)
}

// ── The lanes ──
// Each lane's agent types what it's doing, a line at a time, then rests on what it's waiting for, and
// starts over. The page ships each lane at rest, which is what a visitor without motion sees. They type
// only while the board is on the screen. Each line is written whole, and a cover slides off it a letter
// a tick (landing.css § The lanes), so the text changes once a line, not once a letter.
const TICK = 34
const board = document.querySelector('.board')
if (board) {
  const lanes = all<HTMLElement>('[data-feed]').map((feed, index) => {
    const lane = feed.closest<HTMLElement>('.lane')!
    const lines: string[] = JSON.parse(feed.dataset.feed!)
    let [line, wait, typing] = [lines.length, 20 + index * 30, false]
    let cover: Animation | undefined
    return () => {
      if (wait-- > 0) return
      if (typing) {
        typing = false
        line++
        wait = 18
        if (line < lines.length) return
        delete lane.dataset.working
        wait = 150
        return
      }
      if (line === lines.length) line = 0
      const said = lines[line]
      lane.dataset.working = ''
      feed.textContent = said
      cover?.cancel()
      cover = feed.animate(
        { translate: ['0', `${said.length}ch`] },
        { duration: said.length * TICK, easing: `steps(${said.length})`, fill: 'both', pseudoElement: '::after' },
      )
      typing = true
      wait = said.length - 1
    }
  })
  let timer: ReturnType<typeof setInterval> | undefined
  new IntersectionObserver(([entry]) => {
    clearInterval(timer)
    if (entry.isIntersecting) timer = setInterval(() => motion.matches && lanes.forEach((tick) => tick()), TICK)
  }).observe(board)
}

// ── The terminal ──
// The pairing output types itself out once, at the speed a terminal prints.
onApproach(all('[data-typed]'), (output) => {
  if (!motion.matches) return
  const text = output.textContent!
  // The box keeps its full height, so nothing under it moves while it fills.
  output.style.minBlockSize = `${output.offsetHeight}px`
  let shown = 0
  const type = () => {
    shown += 4
    output.textContent = text.slice(0, shown)
    if (shown < text.length) requestAnimationFrame(type)
  }
  type()
})

// ── The window, taken apart ──
// Each part a plugin draws gets a copy of the whole window, cut down to that part's box, which the
// styles lift off the window as the scene scrolls. The parts are named as the capture names them, so a
// capture that renames one loses that part rather than lifting the wrong one.
const PARTS: [selector: string, name: string, lift: number][] = [
  ['.rail-host', 'rail icons', 1],
  ['.pane:has(> [aria-label="Git list"])', 'git', 2],
  ['.pane:has(> [aria-label="Agent list"])', 'agents', 3.2],
  ['.ui-drawer', 'terminal', 4.4],
  ['.pane-switcher', 'pane buttons', 1.6],
]
onApproach(
  all('[data-explode]'),
  (view) => {
    const figure = view.querySelector<HTMLElement>('figure')!
    // Measured against the app's own root, which fills the frame. An off-screen window isn't painted
    // (landing.css), and its boxes then read at the app's full size, not scaled to the frame. The
    // root reads the same way, so a part's share of it holds either way.
    const whole = figure.querySelector('.acorn-ui')!.getBoundingClientRect()
    // Every part is measured before the window goes into the wrapper that tilts it.
    const boxes = PARTS.map(([selector]) => figure.querySelector(selector)?.getBoundingClientRect())
    const tilt = document.createElement('div')
    tilt.className = 'apart-tilt'
    figure.replaceWith(tilt)
    tilt.append(figure)
    PARTS.forEach(([selector, name, lift], index) => {
      const box = boxes[index]
      if (!box?.width) return
      const part = document.createElement('div')
      part.className = 'apart-part'
      part.ariaHidden = 'true'
      const at = { x: box.left - whole.left, y: box.top - whole.top }
      part.style.cssText = `--x: ${at.x / whole.width}; --y: ${at.y / whole.height}; --w: ${box.width / whole.width}; --h: ${box.height / whole.height}; --lift: ${lift}`
      const copy = figure.cloneNode(true) as HTMLElement
      // The copy is a picture of a picture, so it gives up the ids the first one holds.
      copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
      // Only the part itself is painted. Everything beside it, at each level up to the window, keeps
      // its place in the layout and is hidden, or six whole windows would paint where one is seen.
      for (let kept = copy.querySelector<HTMLElement>(selector)!; kept !== copy; kept = kept.parentElement!) {
        for (const beside of kept.parentElement!.children) {
          if (beside !== kept) (beside as HTMLElement).style.visibility = 'hidden'
        }
      }
      const cut = document.createElement('div')
      cut.append(copy)
      const label = document.createElement('span')
      label.textContent = name
      part.append(cut, label)
      tilt.append(part)
    })
  },
  '100% 0px',
)
// More than a screen away, the picture isn't drawn (landing.css).
const far = new IntersectionObserver(
  (entries) => entries.forEach(({ target, isIntersecting }) => target.toggleAttribute('data-far', !isIntersecting)),
  { rootMargin: '100% 0px' },
)
all('[data-explode]').forEach((view) => far.observe(view))
