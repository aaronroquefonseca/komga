import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {PhysicalSinglePageEdgePlan, physicalSinglePageEdgePlan} from '@/functions/paged-reader-physical'
import {paperCurlDynamicGeometry} from '@/functions/paged-reader-transition'
import {isPageLandscape} from '@/functions/page'
import {PageDtoWithUrl} from '@/types/komga-books'

const DIRECT_CURL_END = 0.90
// At progress 0.5 a centred horizontal fold reaches the opposite bound edge but
// has not reflected the free edge beyond the source rectangle. Stay just below
// that point so this transition reads as an in-place peel, not a fake spine turn.
const DIRECT_PEEL_MAX = 0.49

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Match only the direct/aligned source-level portrait -> wide edge.
 * Synthetic-blank edges have their own multi-phase staged compositor and must
 * never be touched by this final owner; otherwise its outer-spread overrides
 * compete with slide -> blank -> curl / curl -> blank -> slide rendering.
 */
function portraitToWidePlan(reader: any): PhysicalSinglePageEdgePlan | null {
  if (!reader ||
    reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.pageLayout !== PagedReaderLayout.SINGLE_PAGE ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null) return null

  const current = reader.spreads?.[reader.drag.currentIndex] as PageDtoWithUrl[] | undefined
  const target = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined
  if (!current || !target || current.length !== 1 || target.length !== 1) return null
  if (isPageLandscape(current[0]) || !isPageLandscape(target[0])) return null

  const plan = physicalSinglePageEdgePlan(
    reader.spreads || [],
    reader.drag.currentIndex,
    reader.drag.targetIndex,
    !!reader.flipDirection,
  )

  // The staged transition plugin exclusively owns any edge containing a virtual
  // alignment blank. This final owner is only for the no-blank direct peel.
  if (!plan || plan.crossesSyntheticBlank) return null
  return plan
}

function hasClass(vnode: VNode | undefined, className: string): boolean {
  const staticClass = vnode?.data?.staticClass || ''
  return staticClass.split(/\s+/).includes(className)
}

function findNodes(vnode: VNode | undefined, className: string, out: VNode[] = []): VNode[] {
  if (!vnode) return out
  if (hasClass(vnode, className)) out.push(vnode)
  for (const child of vnode.children || []) {
    if (!child || typeof child !== 'object') continue
    findNodes(child as VNode, className, out)
  }
  return out
}

function patchNodes(vnode: VNode, className: string, style: Record<string, string>): VNode[] {
  const nodes = findNodes(vnode, className)
  nodes.forEach(node => {
    node.data = node.data || {}
    node.data.style = {
      ...(node.data.style as Record<string, string> || {}),
      ...style,
    }
  })
  return nodes
}

function pinTurningGroups(vnode: VNode): void {
  const classes = [
    'single-page-wide-turning-group',
    'single-page-physical-turning-group',
  ]

  classes.forEach(className => {
    patchNodes(vnode, className, {
      // The outer sheet never moves during curl. The direct aligned path already
      // begins on the idle centred portrait.
      transform: 'translate3d(0, 0, 0)',
      willChange: 'opacity, clip-path',
    })
  })
}

/**
 * The direct/aligned edge has no intermediate physical page. Its visible
 * sequence is the existing portrait peeling immediately over the real target
 * wide artwork, followed by the final wide-layout fade. Strip only the obsolete
 * source-intro representation; the stationary half of the target must remain
 * fully present behind the turning sheet so the curl reveals actual artwork.
 */
function removeAlignedIntro(vnode: VNode, plan: PhysicalSinglePageEdgePlan): void {
  if (plan.crossesSyntheticBlank) return

  // Do not fade this half in before the curl. It is simply the stationary paper
  // underneath the turning source and becomes visible naturally as the source is
  // clipped by the fold.
  patchNodes(vnode, 'single-page-wide-stationary-target', {
    opacity: '1',
  })

  const stagedIntro = patchNodes(vnode, 'single-page-staged-aligned-source', {
    opacity: '0',
  })

  if (stagedIntro.length > 0) {
    patchNodes(vnode, 'single-page-physical-turning-group', {
      opacity: '1',
      zIndex: '8',
      transform: 'translate3d(0, 0, 0)',
    })
  }
}

function rootSize(sheet: any): {width: number, height: number} {
  if (sheet.$el instanceof HTMLElement) {
    const rect = sheet.$el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return {width: rect.width, height: rect.height}
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  }
}

/**
 * A centred single-page view has no real book spine at either side of the image.
 * Treat the transition as a peel inside the exact idle page rectangle instead:
 * only the turning sheet is clipped to that rectangle. The stationary target
 * half stays outside this clip and underneath the sheet, so the curl can reveal
 * the real dual-page artwork instead of an opaque white group background.
 */
function containAlignedPeel(sheet: any, vnode: VNode, plan: PhysicalSinglePageEdgePlan): void {
  if (plan.crossesSyntheticBlank || !sheet.pageBounds) return

  const {left, top, width, height} = sheet.pageBounds
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return

  const root = rootSize(sheet)
  const right = Math.max(0, root.width - left - width)
  const bottom = Math.max(0, root.height - top - height)
  const clip = `inset(${Math.max(0, top)}px ${right}px ${bottom}px ${Math.max(0, left)}px)`

  ;['single-page-wide-turning-group', 'single-page-physical-turning-group'].forEach(className => {
    patchNodes(vnode, className, {
      clipPath: clip,
      WebkitClipPath: clip,
      overflow: 'hidden',
      background: 'transparent',
    })
  })
}

/**
 * Last reader owner for direct portrait -> wide Physical Comic transitions.
 * Synthetic-blank transitions intentionally fall through untouched.
 */
export function installSinglePageWideOwner(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || readerOptions.__singlePageWideOwnerInstalled) return
  readerOptions.__singlePageWideOwnerInstalled = true

  const originalEffectiveTransition = readerOptions.methods?.effectiveTransition
  if (typeof originalEffectiveTransition === 'function') {
    readerOptions.methods.effectiveTransition = function (this: any): PagedReaderTransition {
      if (portraitToWidePlan(this)) return PagedReaderTransition.PAPER_CURL
      return originalEffectiveTransition.call(this)
    }
  }

  const originalShouldRenderCustomSpread = readerOptions.methods?.shouldRenderCustomSpread
  if (typeof originalShouldRenderCustomSpread === 'function') {
    readerOptions.methods.shouldRenderCustomSpread = function (this: any, spreadIndex: number): boolean {
      if (portraitToWidePlan(this)) return spreadIndex === this.drag.currentIndex
      return originalShouldRenderCustomSpread.call(this, spreadIndex)
    }
  }

  const originalCustomSpreadStyle = readerOptions.methods?.customSpreadStyle
  if (typeof originalCustomSpreadStyle === 'function') {
    readerOptions.methods.customSpreadStyle = function (this: any, spreadIndex: number): Record<string, string> {
      if (!portraitToWidePlan(this)) return originalCustomSpreadStyle.call(this, spreadIndex)

      if (spreadIndex === this.drag.currentIndex) {
        return {
          transform: 'translate3d(0, 0, 0)',
          opacity: '1',
          zIndex: '4',
          pointerEvents: 'none',
          filter: 'none',
        }
      }

      return {
        transform: 'translate3d(0, 0, 0)',
        opacity: '0',
        zIndex: '0',
        pointerEvents: 'none',
        filter: 'none',
      }
    }
  }

  // The aligned path begins peeling at gesture progress 0. Unlike a true page
  // turn, it deliberately never reaches the reflected state beyond the opposite
  // edge of the centred source rectangle; the final 10% fade performs the layout
  // change into the complete wide scan.
  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      const plan = portraitToWidePlan(this.$parent as any)
      if (!plan) return originalGeometry.call(this)

      const localProgress = clamp01(this.progress / DIRECT_CURL_END)
      return paperCurlDynamicGeometry(
        localProgress * DIRECT_PEEL_MAX,
        this.touchCaptured ? this.touchStartY : 0.5,
        this.touchCaptured ? this.touchCurrentY : 0.5,
        this.direction,
        this.heightOverWidth,
      )
    }
  }

  const originalRender = paperOptions.render
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const plan = portraitToWidePlan(this.$parent as any)
    if (!plan) return vnode

    pinTurningGroups(vnode)
    removeAlignedIntro(vnode, plan)
    containAlignedPeel(this, vnode, plan)
    return vnode
  }
}
