import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalPageFace,
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'
import {PageDtoWithUrl} from '@/types/komga-books'

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

function forwardIntoWide(reader: any): PhysicalSinglePageEdgePlan | null {
  const plan = singlePlan(reader)
  if (!plan ||
    plan.kind !== 'curl' ||
    plan.direction <= 0 ||
    plan.currentWide ||
    !plan.targetWide) return null
  return plan
}

/**
 * Under a normal single-page physical curl, the page behind the turning sheet is
 * a physical face, not necessarily the next source image. This matters when the
 * source sequence contains a synthetic alignment blank or one half of a wide
 * scan.
 */
function topologyUnderFace(reader: any): PhysicalPageFace | null {
  const plan = singlePlan(reader)
  if (!plan || plan.kind !== 'curl' || plan.currentWide || plan.targetWide) return null
  return plan.direction > 0 ? plan.baseFaces[1] : plan.baseFaces[0]
}

type ViewportRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function paintedImageRect(image: HTMLImageElement): ViewportRect | null {
  const rect = image.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }
  }

  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  const left = rect.left + (rect.width - width) / 2
  const top = rect.top + (rect.height - height) / 2
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
}

/**
 * Return the exact rectangle of the untouched idle single page, expressed in
 * paper-sheet local coordinates. The hidden custom-layout anchor always stays on
 * visualPage while a gesture is prepared, so unlike transition DOM it cannot be
 * moved to a half-spread slot by any curl compositor.
 */
function idlePageBounds(sheet: any, reader: any): ViewportRect | null {
  if (!(sheet.$el instanceof HTMLElement) || !(reader?.$el instanceof HTMLElement)) return null

  const anchor = reader.$el.querySelector('.custom-layout-anchor')
  if (!(anchor instanceof HTMLElement)) return null

  const rects = Array.from(anchor.querySelectorAll('img'))
    .map(image => paintedImageRect(image as HTMLImageElement))
    .filter((rect): rect is ViewportRect => rect !== null)
  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.left))
  const top = Math.min(...rects.map(rect => rect.top))
  const right = Math.max(...rects.map(rect => rect.right))
  const bottom = Math.max(...rects.map(rect => rect.bottom))
  const root = sheet.$el.getBoundingClientRect()

  return {
    left: left - root.left,
    top: top - root.top,
    right: right - root.left,
    bottom: bottom - root.top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function syncAlignedWideBounds(sheet: any, reader: any, plan: PhysicalSinglePageEdgePlan): void {
  // The blank-staged path intentionally owns a separate intermediate sheet and
  // is already stable. Only the direct portrait -> wide turn must stay exactly
  // on the idle portrait rectangle for the whole curl.
  if (plan.crossesSyntheticBlank) return

  const bounds = idlePageBounds(sheet, reader)
  if (!bounds) return

  const current = sheet.pageBounds
  const changed = !sheet.pageBoundsReady || !current ||
    Math.abs(current.left - bounds.left) > 0.25 ||
    Math.abs(current.top - bounds.top) > 0.25 ||
    Math.abs(current.width - bounds.width) > 0.25 ||
    Math.abs(current.height - bounds.height) > 0.25

  if (!changed) return

  sheet.pageBounds = {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  }
  sheet.pageBoundsReady = true
  sheet.heightOverWidth = bounds.height / Math.max(1, bounds.width)
  if (typeof sheet.syncTouchGeometry === 'function') sheet.syncTouchGeometry()
}

function faceImageStyle(face: PhysicalPageFace): Record<string, string> {
  if (face.crop === 'full') {
    return {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      objectPosition: 'center center',
    }
  }

  return {
    position: 'absolute',
    display: 'block',
    top: '0',
    left: face.crop === 'left' ? '0' : '-100%',
    width: '200%',
    height: '100%',
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'fill',
  }
}

function renderPhysicalFace(
  sheet: any,
  h: CreateElement,
  face: PhysicalPageFace,
): VNode {
  const bounds = sheet.pageBounds
  const rect: Record<string, string> = bounds ? {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    background: '#fff',
  } : {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    background: '#fff',
  }

  const blank = face.page.number <= 0 || !face.page.url
  return h('div', {
    staticClass: 'physical-comic-topology-under-face',
    style: rect,
  }, blank ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: faceImageStyle(face),
    }),
  ])
}

function hasClass(vnode: VNode | undefined, className: string): boolean {
  const staticClass = vnode?.data?.staticClass || ''
  return staticClass.split(/\s+/).includes(className)
}

function findNode(vnode: VNode | undefined, className: string): VNode | undefined {
  if (!vnode) return undefined
  if (hasClass(vnode, className)) return vnode
  for (const child of vnode.children || []) {
    if (!child || typeof child !== 'object') continue
    const found = findNode(child as VNode, className)
    if (found) return found
  }
  return undefined
}

/**
 * Last guard in the reader install chain.
 *
 * 1. A direct portrait -> wide turn always uses the untouched idle portrait's
 *    exact painted rectangle. Cached half-spread pageBounds from lower physical
 *    compositors are overwritten before they can affect curl geometry.
 * 2. A portrait -> wide turn never exposes an older compositor while pageBounds
 *    is being measured. The untouched current page is the bootstrap frame and
 *    also the stable .paper-current measurement surface.
 * 3. Ordinary portrait curls use the physical topology's under-face, so an
 *    inserted blank or a virtual half of a wide scan cannot be skipped merely
 *    because it is not represented by a source-image index.
 */
export function installSinglePageTopologyGuard(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || paperOptions.__singlePageTopologyGuardInstalled) return
  paperOptions.__singlePageTopologyGuardInstalled = true

  const originalUnderSpread = readerOptions.computed?.physicalComicUnderSpread
  if (typeof originalUnderSpread === 'function') {
    readerOptions.computed.physicalComicUnderSpread = function (this: any): PageDtoWithUrl[] | null {
      const plan = singlePlan(this)
      if (plan && plan.kind === 'curl' && !plan.currentWide && !plan.targetWide) {
        const face = plan.direction > 0 ? plan.baseFaces[1] : plan.baseFaces[0]
        return face ? [face.page] : null
      }
      return originalUnderSpread.call(this)
    }
  }

  const originalRender = paperOptions.render
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const parent = this.$parent as any
    const widePlan = forwardIntoWide(parent)

    // Re-anchor direct portrait -> wide geometry on every render. Drag start is
    // not a PagedReaderPaperSheet measurement trigger, so relying on cached
    // pageBounds can preserve a historical spine/half-screen origin indefinitely.
    if (widePlan) syncAlignedWideBounds(this, parent, widePlan)

    // If the anchor is not measurable yet, still never expose a lower compositor
    // for the bootstrap frame. Keep the exact idle source visible until bounds
    // become available.
    if (widePlan && (!this.pageBoundsReady || !this.pageBounds)) {
      const currentSpread = parent.spreads?.[parent.drag.currentIndex] as PageDtoWithUrl[] | undefined
      if (currentSpread) {
        return h('div', {
          staticClass: 'paper-sheet single-page-wide-stable-bootstrap',
          attrs: {'aria-hidden': 'true'},
          style: {
            position: 'absolute',
            inset: '0',
            overflow: 'hidden',
            pointerEvents: 'none',
          },
        }, [
          h('div', {
            staticClass: 'paper-layer paper-current',
            style: {
              position: 'absolute',
              inset: '0',
              zIndex: '4',
            },
          }, [
            h('paged-reader-spread', {
              props: {
                spread: currentSpread,
                flipDirection: this.flipDirection,
                scale: this.scale,
              },
            }),
          ]),
        ])
      }
    }

    const vnode = originalRender.call(this, h) as VNode
    const underFace = topologyUnderFace(parent)
    if (!underFace || !this.pageBoundsReady || !this.pageBounds) return vnode

    const target = findNode(vnode, 'paper-target')
    if (!target) return vnode

    // Replace whatever source-index based under-page the older compositor chose.
    // The existing paper-target transform remains intact, so settlement behavior
    // is unchanged; only the physical surface being moved is corrected.
    target.children = [renderPhysicalFace(this, h, underFace)]
    return vnode
  }
}
