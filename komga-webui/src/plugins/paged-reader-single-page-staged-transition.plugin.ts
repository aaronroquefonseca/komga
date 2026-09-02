import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalPageFace,
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'
import {paperCurlDynamicGeometry} from '@/functions/paged-reader-transition'
import {PageDtoWithUrl} from '@/types/komga-books'

// One reader gesture is deliberately split into deterministic phases. No phase
// shares visible state with another except for the short hand-off cross-fades.
const BLANK_FORWARD_SLIDE_END = 0.28
const BLANK_FORWARD_HANDOFF_END = 0.34
const BLANK_FORWARD_CURL_END = 0.90
const BLANK_BACKWARD_CURL_END = 0.56
const BLANK_BACKWARD_HANDOFF_END = 0.62
const BLANK_BACKWARD_SLIDE_END = 0.90
const ALIGNED_INTRO_END = 0.08
const ALIGNED_CURL_END = 0.90

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function readerPlan(reader: any): PhysicalSinglePageEdgePlan | null {
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
  if (!plan || plan.kind !== 'curl') return null
  if (!plan.currentWide && !plan.targetWide && !plan.crossesSyntheticBlank) return null
  return plan
}

function sheetPlan(sheet: any): PhysicalSinglePageEdgePlan | null {
  return readerPlan(sheet.$parent as any)
}

/**
 * A synthetic blank between a portrait source and a wide source is traversed as
 * portrait -> slide -> blank -> curl -> wide, regardless of navigation direction.
 */
function blankIntoWide(plan: PhysicalSinglePageEdgePlan): boolean {
  return plan.crossesSyntheticBlank && !plan.currentWide && plan.targetWide
}

/**
 * Leaving a compensated wide source is the exact inverse physical sequence:
 * wide -> curl -> blank -> slide -> portrait.
 */
function blankOutOfWide(plan: PhysicalSinglePageEdgePlan): boolean {
  return plan.crossesSyntheticBlank && plan.currentWide && !plan.targetWide
}

function alignedIntoWide(plan: PhysicalSinglePageEdgePlan): boolean {
  return !plan.crossesSyntheticBlank && !plan.currentWide && plan.targetWide
}

function alignedOutOfWide(plan: PhysicalSinglePageEdgePlan): boolean {
  return !plan.crossesSyntheticBlank && plan.currentWide && !plan.targetWide
}

/** Map the reader's one 0..1 gesture to the interval in which paper is curling. */
function curlProgress(plan: PhysicalSinglePageEdgePlan, progress: number): number {
  const p = clamp01(progress)
  if (blankIntoWide(plan)) {
    return clamp01((p - BLANK_FORWARD_HANDOFF_END) /
      (BLANK_FORWARD_CURL_END - BLANK_FORWARD_HANDOFF_END))
  }
  if (blankOutOfWide(plan)) {
    return clamp01(p / BLANK_BACKWARD_CURL_END)
  }
  if (alignedIntoWide(plan)) {
    return clamp01((p - ALIGNED_INTRO_END) / (ALIGNED_CURL_END - ALIGNED_INTRO_END))
  }
  if (alignedOutOfWide(plan)) {
    return clamp01(p / ALIGNED_CURL_END)
  }
  return p
}

function hasClass(vnode: VNode | undefined, className: string): boolean {
  const staticClass = vnode?.data?.staticClass || ''
  return staticClass.split(/\s+/).includes(className)
}

function patchStyle(vnode: VNode | undefined, style: Record<string, string>): void {
  if (!vnode) return
  vnode.data = vnode.data || {}
  vnode.data.style = {
    ...(vnode.data.style as Record<string, string> || {}),
    ...style,
  }
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

function rootWidth(sheet: any): number {
  if (sheet.$el instanceof HTMLElement) {
    const width = sheet.$el.getBoundingClientRect().width
    if (width > 0) return width
  }
  return Math.max(1, window.innerWidth)
}

function isBlank(face: PhysicalPageFace): boolean {
  return face.page.number <= 0 || !face.page.url
}

function samePage(face: PhysicalPageFace | null, page: PageDtoWithUrl | undefined): boolean {
  if (!face || !page) return false
  return face.page === page ||
    (face.page.number === page.number && face.page.url === page.url)
}

function faceSide(face: PhysicalPageFace): 'left' | 'right' | null {
  if (face.crop === 'left') return 'left'
  if (face.crop === 'right') return 'right'
  return null
}

function sourceSide(plan: PhysicalSinglePageEdgePlan, startsRight: boolean): 'left' | 'right' {
  if (plan.currentWide) {
    return faceSide(plan.front) || (startsRight ? 'right' : 'left')
  }
  if (isBlank(plan.front)) return startsRight ? 'right' : 'left'
  if (plan.targetWide) {
    const backSide = faceSide(plan.back)
    if (backSide) return backSide === 'left' ? 'right' : 'left'
  }
  return startsRight ? 'right' : 'left'
}

function centeredPaperRect(sheet: any): Record<string, string> {
  const width = Math.max(1, sheet.pageBounds?.width || 1)
  const height = Math.max(1, sheet.pageBounds?.height || 1)
  const top = Number.isFinite(sheet.pageBounds?.top) ? sheet.pageBounds.top : 0
  const left = (rootWidth(sheet) - width) / 2
  return {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    background: '#fff',
  }
}

function stripLegacyOverlays(vnode: VNode): VNode[] {
  const removed = new Set([
    'single-page-physical-source-layout-fade',
    'single-page-physical-final-layout-fade',
    'single-page-physical-target-settlement',
  ])
  return ((vnode.children || []) as VNode[]).filter(child => {
    for (const className of removed) {
      if (hasClass(child, className)) return false
    }
    return true
  })
}

/**
 * Reset every visual mutation made by the lower single-page compositor. It is
 * still useful for geometry and front/back face construction, but this final
 * stage owns all position/opacity whenever portrait and wide layouts meet.
 */
function normalizePhysicalComposite(
  sheet: any,
  vnode: VNode,
  plan: PhysicalSinglePageEdgePlan,
): {base?: VNode, turning?: VNode, baseLeft?: VNode, baseRight?: VNode} {
  const base = findNode(vnode, 'single-page-physical-base')
  const turning = findNode(vnode, 'single-page-physical-turning-group')
  const baseLeft = findNode(vnode, 'single-page-physical-base-left')
  const baseRight = findNode(vnode, 'single-page-physical-base-right')
  const frontFace = findNode(vnode, 'single-page-physical-front-face')

  const width = Math.max(1, sheet.pageBounds?.width || 1)
  const spine = rootWidth(sheet) / 2
  patchStyle(base, {opacity: '1', zIndex: '1'})
  patchStyle(baseLeft, {left: `${spine - width}px`, opacity: '1'})
  patchStyle(baseRight, {left: `${spine}px`, opacity: '1'})
  patchStyle(frontFace, {opacity: '1'})

  const startsRight = Math.sign(sheet.physicalDirection || -1) < 0
  const side = sourceSide(plan, startsRight)
  const desiredLeft = side === 'left' ? spine - width : spine
  const currentLeft = Number.isFinite(sheet.pageBounds?.left) ? sheet.pageBounds.left : desiredLeft
  // Synthetic blanks have already reached their centered resting position during
  // the slide phase. Never translate that sheet again while it curls; doing so
  // creates a second competing motion and was previously hidden by the final
  // wide-owner override.
  const shift = plan.crossesSyntheticBlank ? 0 : desiredLeft - currentLeft
  patchStyle(turning, {
    transform: `translate3d(${shift}px, 0, 0)`,
    opacity: '1',
    zIndex: '8',
    willChange: 'opacity',
  })

  return {base, turning, baseLeft, baseRight}
}

/**
 * Final owner for single-page Physical Comic transitions involving wide scans.
 *
 * Compensated portrait -> wide:
 *   slide portrait to blank, then curl blank into the wide spread.
 *
 * Compensated wide -> portrait:
 *   curl the wide leaf into the trailing blank, then slide blank to portrait.
 *
 * Both sequences are direction symmetric, so navigating backward reverses the
 * same physical surfaces rather than skipping either synthetic blank.
 */
export function installSinglePagePhysicalStagedTransition(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || paperOptions.__singlePagePhysicalStagedInstalled) return
  paperOptions.__singlePagePhysicalStagedInstalled = true

  const originalDuration = readerOptions.computed?.transitionDuration
  if (typeof originalDuration === 'function') {
    readerOptions.computed.transitionDuration = function (this: any): number {
      const plan = readerPlan(this)
      if (plan?.crossesSyntheticBlank) return 430
      if (plan && plan.currentWide !== plan.targetWide) return 370
      return originalDuration.call(this)
    }
  }

  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      const plan = sheetPlan(this)
      if (!plan) return originalGeometry.call(this)
      return paperCurlDynamicGeometry(
        Math.min(curlProgress(plan, this.progress), 0.9998),
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
    const plan = sheetPlan(this)
    if (!plan || !hasClass(vnode, 'single-page-physical-composite') ||
      !this.pageBoundsReady || !this.pageBounds) return vnode

    const reader = this.$parent as any
    const currentSpread = reader.spreads?.[reader.drag.currentIndex] as PageDtoWithUrl[] | undefined
    const targetSpread = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined
    if (!currentSpread || !targetSpread) return vnode
    const currentPage = currentSpread[0]
    const targetPage = targetSpread[0]

    vnode.children = stripLegacyOverlays(vnode)
    const rootChildren = vnode.children as VNode[]
    const {base, turning, baseLeft, baseRight} = normalizePhysicalComposite(this, vnode, plan)
    const shadow = findNode(vnode, 'paper-shadow')
    const edge = findNode(vnode, 'paper-edge')

    // During slide->blank->curl, the source portrait must disappear once the
    // blank takes over. During curl->blank->slide, the target portrait must stay
    // hidden until its slide phase begins.
    const screenBase: [PhysicalPageFace | null, PhysicalPageFace | null] = this.flipDirection
      ? [plan.baseFaces[1], plan.baseFaces[0]]
      : [plan.baseFaces[0], plan.baseFaces[1]]

    if (blankIntoWide(plan)) {
      if (samePage(screenBase[0], currentPage)) patchStyle(baseLeft, {opacity: '0'})
      if (samePage(screenBase[1], currentPage)) patchStyle(baseRight, {opacity: '0'})
    } else if (blankOutOfWide(plan)) {
      if (samePage(screenBase[0], targetPage)) patchStyle(baseLeft, {opacity: '0'})
      if (samePage(screenBase[1], targetPage)) patchStyle(baseRight, {opacity: '0'})
    }

    const progress = clamp01(this.progress)
    const direction = Math.sign(this.physicalDirection || -1)
    const width = Math.max(1, this.pageBounds.width)
    const localCurl = curlProgress(plan, progress)
    const curlArch = Math.sin(Math.min(localCurl, 0.9998) * Math.PI)
    patchStyle(shadow, {opacity: `${curlArch}`})
    patchStyle(edge, {opacity: `${curlArch}`})

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    const pushSpreadLayer = (
      staticClass: string,
      value: PageDtoWithUrl[],
      style: Record<string, string>,
    ) => rootChildren.push(h('div', {
      staticClass: `paper-layer ${staticClass}`,
      style: {pointerEvents: 'none', ...style},
    }, [spread(value)]))

    const pushBlankLayer = (
      staticClass: string,
      style: Record<string, string>,
    ) => rootChildren.push(h('div', {
      staticClass: `paper-layer ${staticClass}`,
      style: {pointerEvents: 'none', ...style},
    }, [h('div', {style: centeredPaperRect(this)})]))

    if (blankIntoWide(plan)) {
      const slide = smooth(progress / BLANK_FORWARD_SLIDE_END)
      const handoff = smooth((progress - BLANK_FORWARD_SLIDE_END) /
        (BLANK_FORWARD_HANDOFF_END - BLANK_FORWARD_SLIDE_END))
      const settle = smooth((progress - BLANK_FORWARD_CURL_END) /
        (1 - BLANK_FORWARD_CURL_END))
      const physicalOpacity = handoff * (1 - settle)

      patchStyle(base, {opacity: `${physicalOpacity}`})
      patchStyle(turning, {opacity: `${physicalOpacity}`, zIndex: '8'})

      if (progress <= BLANK_FORWARD_HANDOFF_END) {
        if (progress <= BLANK_FORWARD_SLIDE_END) {
          pushSpreadLayer('single-page-staged-source-slide', currentSpread, {
            zIndex: '12',
            opacity: '1',
            transform: `translate3d(${direction * width * slide}px, 0, 0)`,
          })
        }
        pushBlankLayer('single-page-staged-blank-slide', {
          zIndex: '13',
          opacity: `${1 - handoff}`,
          transform: `translate3d(${-direction * width * (1 - slide)}px, 0, 0)`,
        })
      }

      if (settle > 0) {
        pushSpreadLayer('single-page-staged-final-wide', targetSpread, {
          zIndex: '14',
          opacity: `${settle}`,
        })
      }
      return vnode
    }

    if (blankOutOfWide(plan)) {
      const handoff = smooth((progress - BLANK_BACKWARD_CURL_END) /
        (BLANK_BACKWARD_HANDOFF_END - BLANK_BACKWARD_CURL_END))
      const slide = smooth((progress - BLANK_BACKWARD_HANDOFF_END) /
        (BLANK_BACKWARD_SLIDE_END - BLANK_BACKWARD_HANDOFF_END))

      patchStyle(base, {opacity: `${1 - handoff}`})
      patchStyle(turning, {opacity: `${1 - handoff}`, zIndex: '8'})

      if (handoff > 0) {
        pushBlankLayer('single-page-staged-blank-return', {
          zIndex: '13',
          opacity: `${handoff * (1 - slide)}`,
          transform: `translate3d(${direction * width * slide}px, 0, 0)`,
        })
        pushSpreadLayer('single-page-staged-target-slide', targetSpread, {
          zIndex: '14',
          opacity: `${handoff}`,
          transform: `translate3d(${-direction * width * (1 - slide)}px, 0, 0)`,
        })
      }
      return vnode
    }

    if (alignedIntoWide(plan)) {
      const intro = smooth(progress / ALIGNED_INTRO_END)
      const settle = smooth((progress - ALIGNED_CURL_END) / (1 - ALIGNED_CURL_END))
      const physicalOpacity = intro * (1 - settle)
      patchStyle(base, {opacity: `${physicalOpacity}`})
      patchStyle(turning, {opacity: `${physicalOpacity}`, zIndex: '8'})

      if (intro < 1) {
        pushSpreadLayer('single-page-staged-aligned-source', currentSpread, {
          zIndex: '12',
          opacity: `${1 - intro}`,
        })
      }
      if (settle > 0) {
        pushSpreadLayer('single-page-staged-aligned-target', targetSpread, {
          zIndex: '14',
          opacity: `${settle}`,
        })
      }
      return vnode
    }

    if (alignedOutOfWide(plan)) {
      const settle = smooth((progress - ALIGNED_CURL_END) / (1 - ALIGNED_CURL_END))
      patchStyle(base, {opacity: `${1 - settle}`})
      patchStyle(turning, {opacity: `${1 - settle}`, zIndex: '8'})
      if (settle > 0) {
        pushSpreadLayer('single-page-staged-aligned-target', targetSpread, {
          zIndex: '14',
          opacity: `${settle}`,
        })
      }
      return vnode
    }

    // wide -> wide uses the already-stable physical compositor unchanged.
    patchStyle(base, {opacity: '1'})
    patchStyle(turning, {opacity: '1', zIndex: '8'})
    return vnode
  }
}
