import {CreateElement, VNode} from 'vue'

type CurlSheetGeometry = {
  pageBoundsReady: boolean
  pageBounds?: {
    top: number
    width: number
    height: number
  }
  geometry?: {
    seamTop: number
    seamBottom: number
  }
  direction?: number
  paperX?: (percent: number) => number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function styleValue(
  style: Record<string, any> | undefined,
  key: string,
  fallback: string,
): string {
  const value = style?.[key]
  return value === undefined || value === null ? fallback : `${value}`
}

/**
 * Build a narrow, crease-local shadow in sheet coordinates.
 *
 * The stock shadow is eight percent of the sheet width. At extreme diagonal
 * folds that clipped surface can cover a large triangular part of the exposed
 * page on Chromium. This bounded strip remains a visual depth cue without
 * becoming a second dark page-sized surface.
 */
export function safeCreaseShadowStyle(
  sheet: CurlSheetGeometry,
  curl: number,
): Record<string, string> {
  const bounds = sheet.pageBounds
  const geometry = sheet.geometry
  if (!sheet.pageBoundsReady || !bounds || !geometry || typeof sheet.paperX !== 'function') {
    return {opacity: '0'}
  }

  const width = Number(bounds.width)
  const top = Number(bounds.top)
  const bottom = top + Number(bounds.height)
  const seamTop = sheet.paperX(geometry.seamTop)
  const seamBottom = sheet.paperX(geometry.seamBottom)
  if (![width, top, bottom, seamTop, seamBottom].every(Number.isFinite) || width <= 0 || bottom <= top) {
    return {opacity: '0'}
  }

  const arch = Math.sin(clamp01(curl) * Math.PI)
  const stripWidth = Math.min(16, Math.max(5, width * 0.018)) * arch
  const shadowSign = Math.sign(sheet.direction || -1) < 0 ? 1 : -1
  const clipPath = `polygon(${seamTop}px ${top}px, ${seamTop + shadowSign * stripWidth}px ${top}px, ${seamBottom + shadowSign * stripWidth}px ${bottom}px, ${seamBottom}px ${bottom}px)`

  return {
    clipPath,
    WebkitClipPath: clipPath,
    background: 'rgba(0, 0, 0, 0.24)',
    opacity: `${arch}`,
  }
}

/**
 * The visual result of installSafeCurlEffects() without a VNode tree rewrite.
 * Special compositors can mount these nodes from frame zero and keep their
 * structure immutable while still looking like ordinary polished curls.
 */
export function renderSafeCurlShadow(
  h: CreateElement,
  shadowStyle: Record<string, any> | undefined,
  staticClass: string,
): VNode {
  const clipPath = styleValue(shadowStyle, 'clipPath', 'none')
  return h('div', {
    key: staticClass,
    staticClass,
    style: {
      position: 'absolute',
      inset: '0',
      zIndex: '3',
      pointerEvents: 'none',
      clipPath,
      WebkitClipPath: styleValue(shadowStyle, 'WebkitClipPath', clipPath),
      background: styleValue(shadowStyle, 'background', 'transparent'),
      opacity: styleValue(shadowStyle, 'opacity', '0'),
      filter: 'none',
      boxShadow: 'none',
      willChange: 'auto',
      contain: 'none',
      isolation: 'auto',
    },
  })
}

export function renderSafeCurlEdge(
  h: CreateElement,
  edgeStyle: Record<string, any> | undefined,
  staticClass: string,
): VNode {
  const clipPath = styleValue(edgeStyle, 'clipPath', 'none')
  return h('div', {
    key: staticClass,
    staticClass,
    style: {
      position: 'absolute',
      inset: '0',
      zIndex: '6',
      pointerEvents: 'none',
      clipPath,
      WebkitClipPath: styleValue(edgeStyle, 'WebkitClipPath', clipPath),
      background: 'rgba(250, 250, 250, 0.86)',
      opacity: styleValue(edgeStyle, 'opacity', '0'),
      filter: 'none',
      boxShadow: 'none',
      willChange: 'auto',
      contain: 'none',
      isolation: 'auto',
    },
  })
}
