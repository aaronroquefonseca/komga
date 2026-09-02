import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {physicalSinglePageEdgePlan} from '@/functions/paged-reader-physical'

const DIRECT_CURL_END = 0.90

function classNames(vnode: VNode | undefined): string[] {
  return `${vnode?.data?.staticClass || ''}`.split(/\s+/).filter(Boolean)
}

function hasClass(vnode: VNode | undefined, className: string): boolean {
  return classNames(vnode).includes(className)
}

function findNode(vnode: VNode | undefined, className: string): VNode | undefined {
  if (!vnode) return undefined
  if (hasClass(vnode, className)) return vnode
  for (const child of (vnode.children || []) as VNode[]) {
    if (!child || typeof child !== 'object') continue
    const found = findNode(child, className)
    if (found) return found
  }
  return undefined
}

function setOpacity(vnode: VNode | undefined, opacity: number): void {
  if (!vnode) return
  if (!vnode.data) vnode.data = {}
  vnode.data.style = {
    ...((vnode.data.style || {}) as Record<string, string>),
    opacity: `${opacity}`,
  }
}

function directWideExit(reader: any): boolean {
  if (!reader ||
    reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.pageLayout !== PagedReaderLayout.SINGLE_PAGE ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null) return false

  const plan = physicalSinglePageEdgePlan(
    reader.spreads || [],
    reader.drag.currentIndex,
    reader.drag.targetIndex,
    !!reader.flipDirection,
  )

  return !!plan &&
    plan.kind === 'curl' &&
    plan.currentWide &&
    !plan.targetWide &&
    !plan.crossesSyntheticBlank
}

/**
 * The V2 wide -> portrait compositor already has the desired final layout
 * crossfade, but its progress clock is also driven directly by follow-finger.
 * Suppress only that handoff until a committed release. This leaves the proven
 * live physical geometry untouched and restores the existing settlement fade.
 */
export function installWideLayoutHandoff(): void {
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__wideLayoutHandoffInstalled) return
  paperOptions.__wideLayoutHandoffInstalled = true

  const originalRender = paperOptions.render
  if (typeof originalRender !== 'function') return

  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const reader = this.$parent as any
    if (!directWideExit(reader) || Number(this.progress) < DIRECT_CURL_END) return vnode

    if (reader.drag?.settling && reader.drag?.settleCommit) return vnode

    setOpacity(findNode(vnode, 'single-page-wide-v2-turning-group'), 1)
    setOpacity(findNode(vnode, 'single-page-wide-v2-under-current'), 1)
    setOpacity(findNode(vnode, 'single-page-wide-v2-final-target'), 0)
    return vnode
  }
}
