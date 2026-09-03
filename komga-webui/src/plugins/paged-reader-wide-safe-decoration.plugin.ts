import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'
import {
  renderSafeCurlEdge,
  renderSafeCurlShadow,
  safeCreaseEdgeStyle,
  safeCreaseShadowStyle,
} from './paged-reader-safe-curl-primitives'

const OUT_BLANK_CURL_END = 0.56
const DIRECT_CURL_END = 0.90

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

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

function wideExitPlan(reader: any): PhysicalSinglePageEdgePlan | null {
  if (!reader ||
    reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.pageLayout !== PagedReaderLayout.SINGLE_PAGE ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null) return null

  const plan = physicalSinglePageEdgePlan(
    reader.spreads || [],
    reader.drag.currentIndex,
    reader.drag.targetIndex,
    !!reader.flipDirection,
  )

  if (!plan || plan.kind !== 'curl' || !plan.currentWide || plan.targetWide) return null
  return plan
}

/**
 * Wide -> single already has correct physical topology/UNDER geometry. Keep that
 * compositor untouched and restore only the polished curl decoration using the
 * same post-sanitization primitives as ordinary Physical Comic curls.
 *
 * The nodes are present on every render of the gesture and have stable keys; no
 * filtered shadow, blur, box-shadow, paint containment, or subtree handoff is
 * introduced.
 */
export function installWideSafeDecoration(): void {
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__wideSafeDecorationInstalled) return
  paperOptions.__wideSafeDecorationInstalled = true

  const originalRender = paperOptions.render
  if (typeof originalRender !== 'function') return

  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const plan = wideExitPlan(this.$parent as any)
    if (!plan) return vnode

    const turning = findNode(vnode, 'single-page-wide-v2-turning-group')
    if (!turning) return vnode

    const progress = clamp01(Number(this.progress))
    const curlEnd = plan.crossesSyntheticBlank ? OUT_BLANK_CURL_END : DIRECT_CURL_END
    const curl = clamp01(progress / curlEnd)
    const children = (turning.children || []) as VNode[]

    children.push(
      renderSafeCurlShadow(
        h,
        safeCreaseShadowStyle(this, curl),
        'wide-exit-safe-shadow',
      ),
      renderSafeCurlEdge(
        h,
        safeCreaseEdgeStyle(this, curl),
        'wide-exit-safe-edge',
      ),
    )
    turning.children = children
    return vnode
  }
}
