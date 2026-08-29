import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderTransition} from '@/types/enum-reader'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Keep the Physical Comic under-page stationary while the user is still
 * dragging the curled sheet. The under-page slide belongs to the post-release
 * settlement phase; tying it to absolute curl progress makes it start behind a
 * live gesture once the finger passes the old ~66% threshold.
 *
 * The slide is remapped from the release position to settlement completion, so
 * releasing late in the curl cannot cause the under-page to jump immediately to
 * a nearly-completed slide position.
 */
export function installPhysicalPagedReaderSettlementGuard(): void {
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__physicalSettlementGuardInstalled) return
  paperOptions.__physicalSettlementGuardInstalled = true

  const originalRender = paperOptions.render
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const parent = this.$parent as any

    const physicalSingleCurl = parent &&
      parent.transition === PagedReaderTransition.PHYSICAL_COMIC &&
      typeof parent.effectiveTransition === 'function' &&
      parent.effectiveTransition() === PagedReaderTransition.PAPER_CURL &&
      !parent.doublePageLeafTransition &&
      parent.physicalComicUnderSpread

    if (!physicalSingleCurl) return vnode

    const children = (vnode.children || []) as VNode[]
    const target = children.find(child => {
      const staticClass = child?.data?.staticClass || ''
      return staticClass.split(/\s+/).includes('paper-target')
    })
    if (!target?.data) return vnode

    const axisSize = Math.max(1, parent?.drag?.axisSize || window.innerWidth)
    const direction = Math.sign(this.physicalDirection || -1)

    let slideProgress = 0
    if (parent.drag?.settling && parent.drag?.settleCommit) {
      const releaseProgress = clamp01(Math.abs(parent.drag.rawOffset || 0) / axisSize)
      const currentProgress = clamp01(this.progress)
      const remaining = 1 - releaseProgress

      // If the finger was released before the exact endpoint, use the remaining
      // curl distance as the slide's local 0..1 timeline. At exactly 100% there
      // is no remaining curl motion to synchronize with, so leave the under-page
      // pinned rather than flashing a completed slide for one frame.
      if (remaining > 0.001) {
        const local = clamp01((currentProgress - releaseProgress) / remaining)
        slideProgress = 1 - Math.pow(1 - local, 3)
      }
    }

    target.data.style = {
      ...(target.data.style as Record<string, string> || {}),
      transform: `translate3d(${direction * axisSize * slideProgress}px, 0, 0)`,
      willChange: 'transform',
      filter: slideProgress > 0
        ? `drop-shadow(${-direction * 10}px 0 12px rgba(0, 0, 0, ${0.12 + slideProgress * 0.12}))`
        : 'none',
    }

    return vnode
  }
}
