import {CreateElement, VNode} from 'vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalPageFace,
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'
import {PageDtoWithUrl} from '@/types/komga-books'

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

function singlePlan(reader: any): PhysicalSinglePageEdgePlan | null {
  if (!reader ||
    reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.pageLayout !== PagedReaderLayout.SINGLE_PAGE ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null) return null

  return physicalSinglePageEdgePlan(
    reader.spreads || [],
    reader.drag.currentIndex,
    reader.drag.targetIndex,
    !!reader.flipDirection,
  )
}

function sameFace(left: PhysicalPageFace, right: PhysicalPageFace): boolean {
  return left.crop === right.crop && (
    left.page === right.page ||
    (left.page.number === right.page.number && left.page.url === right.page.url)
  )
}

function revealedBaseFace(
  plan: PhysicalSinglePageEdgePlan,
  flipDirection: boolean,
): {face: PhysicalPageFace, side: 'left' | 'right'} | null {
  const screenBase: Array<{face: PhysicalPageFace | null, side: 'left' | 'right'}> = flipDirection
    ? [
      {face: plan.baseFaces[1], side: 'left'},
      {face: plan.baseFaces[0], side: 'right'},
    ]
    : [
      {face: plan.baseFaces[0], side: 'left'},
      {face: plan.baseFaces[1], side: 'right'},
    ]

  // One base face is the untouched half of the current wide scan. The other is
  // the physical page underneath the turned leaf. Pick that other face.
  for (const candidate of screenBase) {
    if (!candidate.face) continue
    const belongsToCurrent = plan.currentFaces.some(face => sameFace(face, candidate.face!))
    if (!belongsToCurrent) return candidate as {face: PhysicalPageFace, side: 'left' | 'right'}
  }
  return null
}

function spreadNode(
  h: CreateElement,
  sheet: any,
  spread: PageDtoWithUrl[],
): VNode {
  return h('paged-reader-spread', {
    props: {
      spread,
      flipDirection: sheet.flipDirection,
      scale: sheet.scale,
    },
  })
}

function rootWidth(sheet: any): number {
  if (sheet.$el instanceof HTMLElement) {
    const width = sheet.$el.getBoundingClientRect().width
    if (width > 0) return width
  }
  return Math.max(1, window.innerWidth)
}

function halfFaceNode(
  h: CreateElement,
  sheet: any,
  face: PhysicalPageFace,
  side: 'left' | 'right',
): VNode {
  const bounds = sheet.pageBounds
  const width = Math.max(1, Number(bounds?.width) || rootWidth(sheet) / 2)
  const top = Number(bounds?.top) || 0
  const height = Math.max(1, Number(bounds?.height) || (sheet.$el instanceof HTMLElement
    ? sheet.$el.getBoundingClientRect().height
    : window.innerHeight))
  const spine = rootWidth(sheet) / 2

  return h('div', {
    staticClass: 'physical-comic-corrected-half-under',
    style: {
      position: 'absolute',
      display: 'block',
      overflow: 'hidden',
      left: `${side === 'left' ? spine - width : spine}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      background: '#fff',
    },
  }, face.page.number <= 0 || !face.page.url ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: {
        position: 'absolute',
        display: 'block',
        top: '0',
        left: face.crop === 'left' ? '0' : '-100%',
        width: '200%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        objectFit: 'fill',
      },
    }),
  ])
}

function setFullSingleUnder(
  node: VNode,
  h: CreateElement,
  sheet: any,
  face: PhysicalPageFace,
  side: 'left' | 'right',
  opacity: string,
): void {
  if (!node.data) node.data = {}
  node.data.style = {
    position: 'absolute',
    inset: '0',
    zIndex: '1',
    opacity,
    overflow: 'visible',
    pointerEvents: 'none',
    filter: 'none',
    willChange: 'auto',
  }

  // A normal single page belongs to the centered single-page layout, not to a
  // left/right half-screen slot. Let PagedReaderSpread perform its ordinary
  // object-fit/centering. Only a virtual half of another wide scan needs a slot.
  node.children = face.crop === 'full'
    ? [spreadNode(h, sheet, [face.page])]
    : [halfFaceNode(h, sheet, face, side)]
}

function turningOpacity(vnode: VNode): string {
  const turning = findNode(vnode, 'single-page-wide-v2-turning-group')
  const opacity = (turning?.data?.style as Record<string, string> | undefined)?.opacity
  return opacity === undefined ? '1' : `${opacity}`
}

function correctWideToSingle(
  vnode: VNode,
  h: CreateElement,
  sheet: any,
  plan: PhysicalSinglePageEdgePlan,
  flipDirection: boolean,
): void {
  if (!plan.currentWide || plan.targetWide) return

  const under = findNode(vnode, 'single-page-wide-v2-under-target-single')
  if (!under) return

  const revealed = revealedBaseFace(plan, flipDirection)
  if (!revealed) return

  // Before persistent parity, most wide exits crossed a trailing synthetic blank
  // and this layer happened to contain the target single page. With real parity,
  // direct exits are common and the physical UNDER is instead the next/previous
  // base face. Render it for both direct and blank exits.
  setFullSingleUnder(
    under,
    h,
    sheet,
    revealed.face,
    revealed.side,
    turningOpacity(vnode),
  )
}

function correctCoverGapUnder(vnode: VNode, h: CreateElement, sheet: any, reader: any): void {
  const under = findNode(vnode, 'single-page-gap-v1-under-target')
  if (!under) return

  const targetSpread = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined
  if (!targetSpread?.[0]) return

  const existingOpacity = (under.data?.style as Record<string, string> | undefined)?.opacity || '0'
  setFullSingleUnder(
    under,
    h,
    sheet,
    {page: targetSpread[0], crop: 'full'},
    'left',
    existingOpacity,
  )
}

function installStableCss(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-wide-curl-stability]')) return

  const style = document.createElement('style')
  style.setAttribute('data-wide-curl-stability', 'true')
  style.textContent = `
    /* Exact compositor baseline proven by ?curlDebug=nofx, applied directly to
       the special state machines instead of depending on effectiveTransition(). */
    .single-page-wide-v2,
    .single-page-gap-v1 {
      contain: none !important;
      isolation: auto !important;
    }

    .single-page-wide-v2 .paper-shadow,
    .single-page-wide-v2 .paper-edge,
    .single-page-wide-v2 .safe-curl-shadow,
    .single-page-wide-v2 .safe-curl-edge,
    .single-page-gap-v1 .paper-shadow,
    .single-page-gap-v1 .paper-edge,
    .single-page-gap-v1 .safe-curl-shadow,
    .single-page-gap-v1 .safe-curl-edge {
      display: none !important;
    }

    .single-page-wide-v2 .paper-current,
    .single-page-wide-v2 .paper-back,
    .single-page-wide-v2 .paper-back-content,
    .single-page-wide-v2 .single-page-wide-v2-turning-group,
    .single-page-gap-v1 .paper-current,
    .single-page-gap-v1 .paper-back,
    .single-page-gap-v1 .paper-back-content,
    .single-page-gap-v1 .single-page-gap-v1-turning-group {
      filter: none !important;
      will-change: auto !important;
      contain: none !important;
      isolation: auto !important;
    }
  `
  document.head.appendChild(style)
}

/**
 * Final correction/stability layer for the special Physical Comic compositors.
 *
 * 1. Apply the proven no-FX compositor baseline unconditionally to portrait <->
 *    wide and inside-cover-gap transitions.
 * 2. A normal single-page UNDER always uses the normal centered single-page
 *    layout, never a half-screen slot.
 * 3. Wide -> single renders the actual non-current base face underneath for both
 *    direct and synthetic-blank exits.
 */
export function installWideCompositorStability(): void {
  installStableCss()

  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__wideCompositorStabilityInstalled) return
  paperOptions.__wideCompositorStabilityInstalled = true

  const originalRender = paperOptions.render
  if (typeof originalRender !== 'function') return

  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const reader = this.$parent as any
    const plan = singlePlan(reader)
    if (!plan || plan.kind !== 'curl') return vnode

    if (plan.crossesSyntheticBlank && !plan.currentWide && !plan.targetWide) {
      correctCoverGapUnder(vnode, h, this, reader)
    }

    if (plan.currentWide && !plan.targetWide) {
      correctWideToSingle(vnode, h, this, plan, !!reader.flipDirection)
    }

    return vnode
  }
}
