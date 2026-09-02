import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderTransition} from '@/types/enum-reader'

function classNames(vnode: VNode): string[] {
  return `${vnode.data?.staticClass || ''}`.split(/\s+/).filter(Boolean)
}

function hasClass(vnode: VNode, name: string): boolean {
  return classNames(vnode).includes(name)
}

function addClass(vnode: VNode, name: string): void {
  if (!vnode.data) vnode.data = {}
  const classes = classNames(vnode)
  if (!classes.includes(name)) classes.push(name)
  vnode.data.staticClass = classes.join(' ')
}

function replaceClass(vnode: VNode, from: string, to: string): void {
  if (!vnode.data) vnode.data = {}
  const classes = classNames(vnode).filter(value => value !== from)
  if (!classes.includes(to)) classes.push(to)
  vnode.data.staticClass = classes.join(' ')
}

function styleOf(vnode: VNode): Record<string, string> {
  return {...((vnode.data?.style || {}) as Record<string, string>)}
}

function setStyle(vnode: VNode, style: Record<string, string>): void {
  if (!vnode.data) vnode.data = {}
  vnode.data.style = style
}

function visit(vnode: VNode, callback: (node: VNode) => void): void {
  callback(vnode)
  for (const child of (vnode.children || []) as VNode[]) {
    if (child && typeof child === 'object') visit(child, callback)
  }
}

function removeUnsafeCompositorProperties(style: Record<string, string>): Record<string, string> {
  const safe = {...style}
  delete safe.filter
  delete safe.willChange
  delete safe.contain
  delete safe.isolation
  delete safe.boxShadow
  return safe
}

function rebuildShadow(vnode: VNode): void {
  const original = styleOf(vnode)
  replaceClass(vnode, 'paper-shadow', 'safe-curl-shadow')
  setStyle(vnode, {
    position: 'absolute',
    inset: '0',
    zIndex: '3',
    pointerEvents: 'none',
    clipPath: original.clipPath || 'none',
    WebkitClipPath: original.WebkitClipPath || original.clipPath || 'none',
    // Keep only the geometry-driven linear gradient. No filter, blur, shadow,
    // isolated paint layer, or compositor promotion is involved.
    background: original.background || 'transparent',
    opacity: original.opacity || '0',
  })
}

function rebuildEdge(vnode: VNode): void {
  const original = styleOf(vnode)
  replaceClass(vnode, 'paper-edge', 'safe-curl-edge')
  setStyle(vnode, {
    position: 'absolute',
    inset: '0',
    zIndex: '6',
    pointerEvents: 'none',
    clipPath: original.clipPath || 'none',
    WebkitClipPath: original.WebkitClipPath || original.clipPath || 'none',
    // A flat paper highlight is visually enough to define the crease. The old
    // edge used box-shadow on a continuously clipped layer, one of the raster
    // combinations deliberately removed by curlDebug=nofx.
    background: 'rgba(250, 250, 250, 0.86)',
    opacity: original.opacity || '0',
  })
}

function isCurl(reader: any): boolean {
  if (!reader) return false
  if (reader.transition === PagedReaderTransition.PAPER_CURL) return true
  if (reader.transition !== PagedReaderTransition.PHYSICAL_COMIC) return false
  return typeof reader.effectiveTransition === 'function' &&
    reader.effectiveTransition() === PagedReaderTransition.PAPER_CURL
}

function installSafeCss(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-safe-curl-effects]')) return
  const style = document.createElement('style')
  style.setAttribute('data-safe-curl-effects', 'true')
  style.textContent = `
    /*
     * Stable curl baseline proven by curlDebug=nofx. Keep clip-path and affine
     * transforms, but never combine them with filter rasterization, paint
     * containment, or per-frame compositor hints on the moving sheet itself.
     * Scope all of this to roots explicitly marked by the curl render wrapper so
     * rigid 3D Page Turn retains its independent rendering path.
     */
    .safe-curl-root {
      contain: none !important;
      isolation: auto !important;
    }

    .safe-curl-root .paper-current,
    .safe-curl-root .paper-back,
    .safe-curl-root .paper-back-content,
    .safe-curl-root .single-page-wide-v2-turning-group,
    .safe-curl-root .double-page-curl-face {
      filter: none !important;
      will-change: auto !important;
    }

    .safe-curl-root .physical-comic-paper-back {
      filter: none !important;
    }

    .safe-curl-root .safe-curl-shadow,
    .safe-curl-root .safe-curl-edge {
      filter: none !important;
      box-shadow: none !important;
      will-change: auto !important;
      contain: none !important;
      isolation: auto !important;
    }
  `
  document.head.appendChild(style)
}

/**
 * Rebuild Paper Curl decoration from the no-FX baseline.
 *
 * curlDebug=nofx proved that the fold/clip/reflection geometry itself can render
 * without flashing on the affected Android Chromium device. The unsafe part was
 * the decoration/compositor stack. Preserve the fold, but replace the old
 * filtered shadow/edge layers with plain clipped color primitives and strip
 * filter/will-change/paint-containment from every curl VNode.
 */
export function installSafeCurlEffects(): void {
  installSafeCss()

  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__safeCurlEffectsInstalled) return
  paperOptions.__safeCurlEffectsInstalled = true

  const originalRender = paperOptions.render
  if (typeof originalRender !== 'function') return

  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const reader = this.$parent as any
    if (!isCurl(reader)) return vnode

    addClass(vnode, 'safe-curl-root')
    visit(vnode, node => {
      if (hasClass(node, 'paper-shadow')) {
        rebuildShadow(node)
        return
      }
      if (hasClass(node, 'paper-edge')) {
        rebuildEdge(node)
        return
      }
      setStyle(node, removeUnsafeCompositorProperties(styleOf(node)))
    })

    return vnode
  }
}
