import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {physicalSinglePageEdgePlan} from '@/functions/paged-reader-physical'

function hasClass(vnode: VNode, name: string): boolean {
  const classes = `${vnode.data?.staticClass || ''}`.split(/\s+/)
  return classes.includes(name)
}

function visit(vnode: VNode, callback: (node: VNode) => void): void {
  callback(vnode)
  for (const child of (vnode.children || []) as VNode[]) {
    if (child && typeof child === 'object') visit(child, callback)
  }
}

function setOpacity(vnode: VNode, opacity: number): void {
  if (!vnode.data) vnode.data = {}
  vnode.data.style = {
    ...((vnode.data.style || {}) as Record<string, string>),
    opacity: `${opacity}`,
  }
}

function isLiveIntoWide(reader: any): boolean {
  if (!reader ||
    reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.pageLayout !== PagedReaderLayout.SINGLE_PAGE ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null ||
    reader.drag.settling) return false

  const plan = physicalSinglePageEdgePlan(
    reader.spreads || [],
    reader.drag.currentIndex,
    reader.drag.targetIndex,
    !!reader.flipDirection,
  )

  return !!plan &&
    plan.kind === 'curl' &&
    !plan.currentWide &&
    plan.targetWide
}

/**
 * Entering a wide source has two different visual coordinate systems:
 *
 *   live physical curl -> final resting wide spread
 *
 * The resting-layout crossfade must never begin merely because the finger has
 * dragged far enough. Doing that used to fade the stationary target half toward
 * the black reader background and then overlay the complete white wide spread,
 * which looked like progressive darkening followed by a viewport-wide white
 * wash at extreme curl angles.
 *
 * Keep the physical FRONT/BACK/UNDER scene authoritative for the complete live
 * gesture. The existing state machine is allowed to perform its final fade only
 * after release, when drag.settling becomes true.
 */
export function installWideLiveDragGuard(): void {
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__wideLiveDragGuardInstalled) return
  paperOptions.__wideLiveDragGuardInstalled = true

  const originalRender = paperOptions.render
  if (typeof originalRender !== 'function') return

  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const reader = this.$parent as any
    if (!isLiveIntoWide(reader)) return vnode

    // The state machine's final handoff begins at 90% progress. Before that its
    // existing opacities are correct (including the synthetic-blank slide). Once
    // the live gesture reaches that zone, pin the physical scene instead.
    if (Number(this.progress) < 0.90) return vnode

    visit(vnode, node => {
      if (hasClass(node, 'single-page-wide-v2-turning-group')) setOpacity(node, 1)
      if (hasClass(node, 'single-page-wide-v2-under-target-wide')) setOpacity(node, 1)
      if (hasClass(node, 'single-page-wide-v2-final-target')) setOpacity(node, 0)
    })

    return vnode
  }
}
