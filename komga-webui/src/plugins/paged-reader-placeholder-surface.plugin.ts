import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'

function isPageZeroImage(vnode: VNode | undefined): boolean {
  if (!vnode || vnode.tag !== 'img') return false
  const attrs = vnode.data?.attrs as Record<string, unknown> | undefined
  return attrs?.alt === 'Page 0'
}

function patchPlaceholderSurfaces(vnode: VNode | undefined): void {
  if (!vnode) return
  const children = (vnode.children || []) as VNode[]

  if (children.some(child => isPageZeroImage(child))) {
    vnode.data = vnode.data || {}
    vnode.data.style = {
      ...(vnode.data.style as Record<string, string> || {}),
      // A real placeholder image already encodes whether this surface is opaque
      // white (internal pagination blank) or transparent (outside a cover).
      // Never replace that semantic distinction with a generic white CSS face.
      background: 'transparent',
    }
  }

  children.forEach(child => {
    if (child && typeof child === 'object') patchPlaceholderSurfaces(child)
  })
}

/**
 * Keep synthetic page-number-0 surfaces faithful to their source image.
 * Internal alignment blanks use an opaque-white data URL, while boundary slots
 * beside the front/back cover use a transparent one. Sheet compositors used to
 * paint both white, making the outside-cover page reappear only during a turn.
 */
export function installPhysicalPlaceholderSurfaces(): void {
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__physicalPlaceholderSurfacesInstalled) return
  paperOptions.__physicalPlaceholderSurfacesInstalled = true

  const originalRender = paperOptions.render
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    patchPlaceholderSurfaces(vnode)
    return vnode
  }
}
