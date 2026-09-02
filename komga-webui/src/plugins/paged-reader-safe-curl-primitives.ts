import {CreateElement, VNode} from 'vue'

function styleValue(
  style: Record<string, any> | undefined,
  key: string,
  fallback: string,
): string {
  const value = style?.[key]
  return value === undefined || value === null ? fallback : `${value}`
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
