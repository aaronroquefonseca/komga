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
 * Build a crease-local shadow in sheet coordinates.
 *
 * Match the stock shadow's eight-percent width and strength, but paint it as an
 * actual bounded strip. At extreme diagonal folds the stock clipped surface has
 * a page-sized compositor box even though only a narrow part is visible.
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
  const stripWidth = width * 0.08 * arch
  const dx = seamBottom - seamTop
  const dy = bottom - top
  const length = Math.hypot(dx, dy)
  if (length <= 0.01 || stripWidth <= 0.01) return {opacity: '0'}

  // Paint a real strip instead of clipping a viewport-sized transparent layer.
  // A diagonal 16px polygon still has a page-sized compositor bounding box;
  // affected Android Chromium builds occasionally blend that whole box as the
  // fold becomes steep. This matrix maps a small local rectangle directly onto
  // the crease, with its x axis pointing toward the exposed side of the paper.
  const shadowSign = Math.sign(sheet.direction || -1) < 0 ? 1 : -1
  const normalX = shadowSign * dy / length
  const normalY = shadowSign * -dx / length
  const tangentX = dx / length
  const tangentY = dy / length
  const alpha = 0.34 * arch

  return {
    left: '0',
    top: '0',
    width: `${stripWidth}px`,
    height: `${length}px`,
    transformOrigin: '0 0',
    transform: `matrix(${normalX}, ${normalY}, ${tangentX}, ${tangentY}, ${seamTop}, ${top})`,
    clipPath: 'none',
    WebkitClipPath: 'none',
    background: `linear-gradient(to right, rgba(0, 0, 0, ${alpha}), rgba(0, 0, 0, 0))`,
    opacity: '1',
  }
}

export function safeCreaseEdgeStyle(
  sheet: CurlSheetGeometry,
  curl: number,
): Record<string, string> {
  const style = safeCreaseShadowStyle(sheet, curl)
  if (style.transform === undefined) return style

  const arch = Math.sin(clamp01(curl) * Math.PI)
  const width = Math.max(0.75, Number(sheet.pageBounds?.width) * 0.0045)
  return {
    ...style,
    width: `${width}px`,
    background: `rgba(250, 250, 250, ${0.98 * arch})`,
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
  const bounded = shadowStyle?.width !== undefined &&
    shadowStyle?.height !== undefined &&
    shadowStyle?.transform !== undefined
  return h('div', {
    key: staticClass,
    staticClass,
    style: {
      position: 'absolute',
      ...(bounded ? {
        left: styleValue(shadowStyle, 'left', '0'),
        top: styleValue(shadowStyle, 'top', '0'),
        width: styleValue(shadowStyle, 'width', '0'),
        height: styleValue(shadowStyle, 'height', '0'),
        transformOrigin: styleValue(shadowStyle, 'transformOrigin', '0 0'),
        transform: styleValue(shadowStyle, 'transform', 'none'),
      } : {inset: '0'}),
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
  const bounded = edgeStyle?.width !== undefined &&
    edgeStyle?.height !== undefined &&
    edgeStyle?.transform !== undefined
  return h('div', {
    key: staticClass,
    staticClass,
    style: {
      position: 'absolute',
      ...(bounded ? {
        left: styleValue(edgeStyle, 'left', '0'),
        top: styleValue(edgeStyle, 'top', '0'),
        width: styleValue(edgeStyle, 'width', '0'),
        height: styleValue(edgeStyle, 'height', '0'),
        transformOrigin: styleValue(edgeStyle, 'transformOrigin', '0 0'),
        transform: styleValue(edgeStyle, 'transform', 'none'),
      } : {inset: '0'}),
      zIndex: '6',
      pointerEvents: 'none',
      clipPath,
      WebkitClipPath: styleValue(edgeStyle, 'WebkitClipPath', clipPath),
      background: styleValue(edgeStyle, 'background', 'rgba(250, 250, 250, 0.86)'),
      opacity: styleValue(edgeStyle, 'opacity', '0'),
      filter: 'none',
      boxShadow: 'none',
      willChange: 'auto',
      contain: 'none',
      isolation: 'auto',
    },
  })
}
