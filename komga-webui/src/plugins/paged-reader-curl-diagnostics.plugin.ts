import PagedReader from '@/components/readers/PagedReader.vue'

type CurlDebugMode = 'nofx' | 'nounder' | 'noback' | 'probe' | 'freeze'

type SurfaceSnapshot = {
  selector: string
  classes: string
  images: string[]
  rect: string
  visibility: string
  opacity: string
  zIndex: string
  clipPath: string
  transform: string
}

type CurlTraceEntry = {
  sequence: number
  time: number
  phase: string
  drag: Record<string, unknown>
  spreads: Record<string, unknown>
  surfaces: SurfaceSnapshot[]
}

const SURFACE_SELECTORS = [
  '.custom-layout-anchor',
  '.transition-layer',
  '.double-page-curl-base-left',
  '.double-page-curl-base-right',
  '.double-page-curl-front-face',
  '.double-page-curl-back-face',
  '.double-page-curl-current',
  '.double-page-curl-back',
]

function debugMode(): CurlDebugMode | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('curlDebug')
  return value === 'nofx' || value === 'nounder' || value === 'noback' ||
    value === 'probe' || value === 'freeze'
    ? value
    : null
}

function addStyle(css: string): void {
  const style = document.createElement('style')
  style.setAttribute('data-curl-debug', 'true')
  style.textContent = css
  document.head.appendChild(style)
}

function pageIdentity(page: any): Record<string, unknown> {
  return {
    number: page?.number ?? null,
    url: page?.url ?? null,
    width: page?.width ?? null,
    height: page?.height ?? null,
  }
}

function spreadIdentity(reader: any, index: number | null): Record<string, unknown>[] | null {
  if (index === null || !reader.spreads?.[index]) return null
  return reader.spreads[index].map(pageIdentity)
}

function rounded(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : 'NaN'
}

function surfaceSnapshot(root: HTMLElement, selector: string): SurfaceSnapshot[] {
  return Array.from(root.querySelectorAll(selector)).map(element => {
    const html = element as HTMLElement
    const style = window.getComputedStyle(html)
    const rect = html.getBoundingClientRect()
    return {
      selector,
      classes: html.className,
      images: Array.from(html.querySelectorAll('img')).map(image => image.currentSrc || image.src),
      rect: `${rounded(rect.left)},${rounded(rect.top)} ${rounded(rect.width)}x${rounded(rect.height)}`,
      visibility: style.visibility,
      opacity: style.opacity,
      zIndex: style.zIndex,
      clipPath: style.clipPath || style.getPropertyValue('-webkit-clip-path'),
      transform: style.transform,
    }
  })
}

function capture(reader: any, phase: string): CurlTraceEntry {
  const root = reader.$el instanceof HTMLElement ? reader.$el : null
  const entry: CurlTraceEntry = {
    sequence: Number(reader.__curlProbeSequence) || 0,
    time: performance.now(),
    phase,
    drag: {
      tracking: !!reader.drag?.tracking,
      prepared: !!reader.drag?.prepared,
      active: !!reader.drag?.active,
      rawOffset: Number(reader.drag?.rawOffset) || 0,
      offset: Number(reader.drag?.offset) || 0,
      progress: Number(reader.transitionProgressValue) || 0,
      physicalDirection: Number(reader.drag?.physicalDirection) || 0,
      navigationDelta: Number(reader.drag?.navigationDelta) || 0,
      currentIndex: Number(reader.drag?.currentIndex) || 0,
      targetIndex: reader.drag?.targetIndex ?? null,
      cover: !!reader.drag?.directionHandoffCover,
      coverPendingHide: !!reader.__doublePageDirectionCoverPendingHide,
    },
    spreads: {
      visual: spreadIdentity(reader, reader.visualPage),
      current: spreadIdentity(reader, reader.drag?.currentIndex ?? null),
      target: spreadIdentity(reader, reader.drag?.targetIndex ?? null),
      paperFront: (reader.paperCurlFrontSpread || []).map(pageIdentity),
      paperBack: (reader.paperCurlBackSpread || []).map(pageIdentity),
    },
    surfaces: root
      ? SURFACE_SELECTORS.flatMap(selector => surfaceSnapshot(root, selector))
      : [],
  }

  const diagnostics = window as any
  const trace = (diagnostics.__curlDebugTrace || []) as CurlTraceEntry[]
  trace.push(entry)
  if (trace.length > 240) trace.splice(0, trace.length - 240)
  diagnostics.__curlDebugTrace = trace
  window.localStorage.setItem('curlDebugTrace', JSON.stringify(trace))
  window.dispatchEvent(new CustomEvent('curl-debug-capture', {detail: entry}))
  return entry
}

function capturePaintSequence(reader: any): void {
  reader.$nextTick(() => {
    capture(reader, 'vue-next-tick')
    let frame = 0
    const next = () => {
      frame++
      capture(reader, `paint-${frame}`)
      if (frame < 8) window.requestAnimationFrame(next)
    }
    window.requestAnimationFrame(next)
  })
}

function downloadTrace(): void {
  const trace = (window as any).__curlDebugTrace || []
  const blob = new Blob([JSON.stringify(trace, null, 2)], {type: 'application/json'})
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `curl-debug-${Date.now()}.json`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
}

function addBadge(mode: CurlDebugMode): void {
  const badge = document.createElement('div')
  badge.setAttribute('data-curl-debug-badge', 'true')
  Object.assign(badge.style, {
    position: 'fixed',
    left: '6px',
    bottom: '6px',
    zIndex: '2147483647',
    padding: '6px 8px',
    maxWidth: 'calc(100vw - 12px)',
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.3',
    color: '#fff',
    background: 'rgba(0,0,0,.84)',
    pointerEvents: mode === 'probe' || mode === 'freeze' ? 'auto' : 'none',
  })

  const status = document.createElement('span')
  status.textContent = `curlDebug=${mode}`
  badge.appendChild(status)

  if (mode === 'probe' || mode === 'freeze') {
    const button = document.createElement('button')
    button.textContent = 'Download trace'
    button.style.marginLeft = '8px'
    button.addEventListener('click', downloadTrace)
    badge.appendChild(button)
    window.addEventListener('curl-debug-capture', ((event: CustomEvent<CurlTraceEntry>) => {
      const entry = event.detail
      const drag = entry.drag
      status.textContent = `probe #${entry.sequence} ${entry.phase} dir=${drag.physicalDirection} nav=${drag.navigationDelta} target=${drag.targetIndex} cover=${drag.cover}`
    }) as EventListener)
  }

  document.body.appendChild(badge)
}

function installProbe(mode: 'probe' | 'freeze'): void {
  const readerOptions = (PagedReader as any).options
  const originalFollowFingerMove = readerOptions?.methods?.followFingerMove
  if (typeof originalFollowFingerMove !== 'function' || readerOptions.__curlProbeInstalled) return
  readerOptions.__curlProbeInstalled = true

  readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
    const previousDirection = Number(this.drag?.physicalDirection) || 0
    const previousDelta = Number(this.drag?.navigationDelta) || 0
    originalFollowFingerMove.call(this, event)
    const nextDirection = Number(this.drag?.physicalDirection) || 0
    const nextDelta = Number(this.drag?.navigationDelta) || 0
    const crossed = previousDirection !== 0 && nextDirection !== 0 && previousDirection !== nextDirection

    if (!crossed) return
    this.__curlProbeSequence = (Number(this.__curlProbeSequence) || 0) + 1
    capture(this, 'direction-cross-sync')
    capturePaintSequence(this)

    if (mode === 'freeze') {
      // Freeze only after the real mutation has reached the final touch wrapper.
      // The exact failing state then remains inspectable instead of lasting for
      // a single refresh interval.
      this.drag.tracking = false
      this.drag.velocity = 0
      this.suppressClickUntil = Date.now() + 2000
      this.$forceUpdate()
      capture(this, `frozen-from-${previousDelta}-to-${nextDelta}`)
    }
  }
}

/** Opt-in curl diagnostics. Normal reader behavior is untouched without the query parameter. */
export function installCurlDiagnostics(): void {
  if (typeof document === 'undefined') return
  const mode = debugMode()
  if (!mode) return

  document.documentElement.setAttribute('data-curl-debug-mode', mode)

  if (mode === 'probe' || mode === 'freeze') {
    ;(window as any).__curlDebugTrace = []
    window.localStorage.removeItem('curlDebugTrace')
    installProbe(mode)
    addStyle(`
      [data-curl-debug-mode="${mode}"] .custom-layout-anchor { outline: 5px solid #00ff66 !important; }
      [data-curl-debug-mode="${mode}"] .double-page-curl-base-left { box-shadow: inset 0 0 0 8px rgba(255, 0, 200, .8) !important; }
      [data-curl-debug-mode="${mode}"] .double-page-curl-base-right { box-shadow: inset 0 0 0 8px rgba(0, 220, 255, .8) !important; }
      [data-curl-debug-mode="${mode}"] .double-page-curl-front-face { outline: 6px solid #ffe600 !important; }
      [data-curl-debug-mode="${mode}"] .double-page-curl-back-face { outline: 6px solid #3878ff !important; }
    `)
  }

  if (mode === 'nofx') {
    addStyle(`
      [data-curl-debug-mode="nofx"] .paper-shadow,
      [data-curl-debug-mode="nofx"] .paper-edge,
      [data-curl-debug-mode="nofx"] .safe-curl-shadow,
      [data-curl-debug-mode="nofx"] .safe-curl-edge { display: none !important; }
      [data-curl-debug-mode="nofx"] .paper-back,
      [data-curl-debug-mode="nofx"] .paper-back-content,
      [data-curl-debug-mode="nofx"] .paper-current,
      [data-curl-debug-mode="nofx"] .single-page-wide-v2-turning-group,
      [data-curl-debug-mode="nofx"] .double-page-curl-face {
        filter: none !important;
        will-change: auto !important;
      }
      [data-curl-debug-mode="nofx"] .paper-sheet,
      [data-curl-debug-mode="nofx"] .safe-curl-shadow,
      [data-curl-debug-mode="nofx"] .safe-curl-edge {
        contain: none !important;
        isolation: auto !important;
      }
    `)
  }

  if (mode === 'nounder') {
    addStyle(`
      [data-curl-debug-mode="nounder"] .paper-target,
      [data-curl-debug-mode="nounder"] .single-page-wide-v2-under-current,
      [data-curl-debug-mode="nounder"] .single-page-wide-v2-under-target-wide,
      [data-curl-debug-mode="nounder"] .single-page-wide-v2-under-target-single,
      [data-curl-debug-mode="nounder"] .double-page-curl-base { visibility: hidden !important; }
    `)
  }

  if (mode === 'noback') {
    addStyle(`
      [data-curl-debug-mode="noback"] .paper-back,
      [data-curl-debug-mode="noback"] .single-page-wide-v2-back { visibility: hidden !important; }
    `)
  }

  if (document.body) addBadge(mode)
  else window.addEventListener('DOMContentLoaded', () => addBadge(mode), {once: true})
}
