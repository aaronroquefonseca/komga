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
import {
  renderSafeCurlEdge,
  renderSafeCurlShadow,
  safeCreaseShadowStyle,
} from './paged-reader-safe-curl-primitives'

const INTO_BLANK_SLIDE_END = 0.30
const INTO_CURL_END = 0.90
const OUT_BLANK_CURL_END = 0.56
const OUT_BLANK_HANDOFF_END = 0.62
const OUT_BLANK_SLIDE_END = 0.90
const PHASE_BLEND = 0.025

type GapMode = 'into-blank' | 'out-blank'

type PaintedRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/**
 * The only portrait-to-portrait synthetic gap in the current topology is the
 * missing inside-cover face. It must use the same staged blank choreography as
 * compensated wide pages rather than the generic single-page curl compositor.
 */
function gapPlan(reader: any): PhysicalSinglePageEdgePlan | null {
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

  if (!plan ||
    plan.kind !== 'curl' ||
    !plan.crossesSyntheticBlank ||
    plan.currentWide ||
    plan.targetWide) return null

  return plan
}

function gapMode(plan: PhysicalSinglePageEdgePlan): GapMode {
  // Forward: cover curls to its blank back, then the next source slides into the
  // centered idle position. Backward is the exact inverse: source -> blank slide,
  // then blank curls back onto the cover.
  return plan.direction > 0 ? 'out-blank' : 'into-blank'
}

function isBlank(face: PhysicalPageFace): boolean {
  return face.page.number <= 0 || !face.page.url
}

function samePage(face: PhysicalPageFace | null, page: PageDtoWithUrl | undefined): boolean {
  if (!face || !page) return false
  return face.page === page ||
    (face.page.number === page.number && face.page.url === page.url)
}

function paintedImageRect(image: HTMLImageElement): PaintedRect | null {
  const rect = image.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (naturalWidth <= 0 || naturalHeight <= 0) return null

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

function rootRect(sheet: any): DOMRect | null {
  return sheet.$el instanceof HTMLElement ? sheet.$el.getBoundingClientRect() : null
}

function rootWidth(sheet: any): number {
  const rect = rootRect(sheet)
  return rect && rect.width > 0 ? rect.width : Math.max(1, window.innerWidth)
}

function idlePaintedWidth(reader: any): number | null {
  if (!(reader?.$el instanceof HTMLElement)) return null
  const anchor = reader.$el.querySelector('.custom-layout-anchor')
  if (!(anchor instanceof HTMLElement)) return null

  const rects = Array.from(anchor.querySelectorAll('img'))
    .map(image => paintedImageRect(image as HTMLImageElement))
    .filter((rect): rect is PaintedRect => rect !== null)
  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  return Math.max(1, right - left)
}

function measureGapBounds(sheet: any): void {
  if (!(sheet.$el instanceof HTMLElement)) return
  const root = sheet.$el as HTMLElement
  const rootBounds = root.getBoundingClientRect()
  const images = Array.from(root.querySelectorAll('.single-page-gap-v1-measure img')) as HTMLImageElement[]
  const rects = images
    .map(paintedImageRect)
    .filter((rect): rect is PaintedRect => rect !== null)

  if (rects.length === 0) {
    sheet.pageBoundsReady = false
    return
  }

  const left = Math.min(...rects.map(rect => rect.left)) - rootBounds.left
  const top = Math.min(...rects.map(rect => rect.top)) - rootBounds.top
  const right = Math.max(...rects.map(rect => rect.right)) - rootBounds.left
  const bottom = Math.max(...rects.map(rect => rect.bottom)) - rootBounds.top
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)

  sheet.pageBounds = {left, top, width, height}
  sheet.pageBoundsReady = true
  sheet.heightOverWidth = height / width
  if (typeof sheet.syncTouchGeometry === 'function') sheet.syncTouchGeometry()
}

function localCurlProgress(plan: PhysicalSinglePageEdgePlan, progress: number): number {
  const p = clamp01(progress)
  if (gapMode(plan) === 'into-blank') {
    return clamp01((p - INTO_BLANK_SLIDE_END) / (INTO_CURL_END - INTO_BLANK_SLIDE_END))
  }
  return clamp01(p / OUT_BLANK_CURL_END)
}

function faceImageStyle(): Record<string, string> {
  return {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    objectPosition: 'center center',
  }
}

function renderFace(
  h: CreateElement,
  face: PhysicalPageFace,
  style: Record<string, string>,
  staticClass: string,
  readableBack = false,
): VNode {
  const content = isBlank(face) ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: faceImageStyle(),
    }),
  ]

  return h('div', {
    staticClass,
    style: {...style, background: '#fff'},
  }, readableBack ? [
    h('div', {
      staticClass: 'single-page-gap-v1-readable-back-artwork',
      style: {
        position: 'absolute',
        inset: '0',
        transform: 'scaleX(-1)',
        transformOrigin: 'center center',
      },
    }, content),
  ] : content)
}

function sourceRect(sheet: any): Record<string, string> {
  if (sheet.pageBoundsReady && sheet.pageBounds) {
    const {left, top, width, height} = sheet.pageBounds
    return {
      position: 'absolute',
      display: 'block',
      overflow: 'hidden',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    }
  }

  const root = rootRect(sheet)
  return {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
    left: '0',
    top: '0',
    width: `${Math.max(1, root?.width || window.innerWidth)}px`,
    height: `${Math.max(1, root?.height || window.innerHeight)}px`,
  }
}

function centeredLeafRect(sheet: any): Record<string, string> {
  const rect = sourceRect(sheet)
  if (!sheet.pageBoundsReady || !sheet.pageBounds) return rect
  return {
    ...rect,
    left: `${(rootWidth(sheet) - sheet.pageBounds.width) / 2}px`,
  }
}

function screenSlotRect(sheet: any, side: 'left' | 'right'): Record<string, string> {
  if (!sheet.pageBoundsReady || !sheet.pageBounds) {
    const width = rootWidth(sheet) / 2
    return {
      position: 'absolute',
      display: 'block',
      overflow: 'hidden',
      left: `${side === 'left' ? 0 : width}px`,
      top: '0',
      width: `${width}px`,
      height: '100%',
    }
  }

  const {top, width, height} = sheet.pageBounds
  const spine = rootWidth(sheet) / 2
  return {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
    left: `${side === 'left' ? spine - width : spine}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
}

function targetUnderFace(
  plan: PhysicalSinglePageEdgePlan,
  flipDirection: boolean,
  targetPage: PageDtoWithUrl | undefined,
): {face: PhysicalPageFace, side: 'left' | 'right'} | null {
  if (!targetPage) return null
  const screenBase: [PhysicalPageFace | null, PhysicalPageFace | null] = flipDirection
    ? [plan.baseFaces[1], plan.baseFaces[0]]
    : [plan.baseFaces[0], plan.baseFaces[1]]

  if (samePage(screenBase[0], targetPage)) return {face: screenBase[0]!, side: 'left'}
  if (samePage(screenBase[1], targetPage)) return {face: screenBase[1]!, side: 'right'}
  return null
}

function emptyLayer(h: CreateElement, staticClass: string): VNode {
  return h('div', {
    staticClass,
    style: {
      position: 'absolute',
      inset: '0',
      opacity: '0',
      pointerEvents: 'none',
    },
  })
}

/**
 * Staged compositor for a synthetic blank between two portrait source states.
 *
 * Forward uses the already-proven wide -> blank -> portrait choreography:
 * cover curls to its blank back, then the blank and next source slide to the
 * normal centered single-page resting state. Backward uses the exact inverse
 * portrait -> blank -> cover choreography.
 *
 * All layers, including safe shadow/crease decoration, remain mounted for the
 * full transition. The decoration uses plain clipped color surfaces without
 * filtered/blurred compositor layers.
 */
export function installSinglePageBlankGapStateMachine(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || readerOptions.__singlePageBlankGapInstalled) return
  readerOptions.__singlePageBlankGapInstalled = true

  const originalDuration = readerOptions.computed?.transitionDuration
  if (typeof originalDuration === 'function') {
    readerOptions.computed.transitionDuration = function (this: any): number {
      return gapPlan(this) ? 430 : originalDuration.call(this)
    }
  }

  const originalMeasureAxisSize = readerOptions.methods?.measureAxisSize
  if (typeof originalMeasureAxisSize === 'function') {
    readerOptions.methods.measureAxisSize = function (this: any, root: HTMLElement): number {
      if (!gapPlan(this)) return originalMeasureAxisSize.call(this, root)
      const viewport = Math.max(1, root.clientWidth || window.innerWidth)
      const width = idlePaintedWidth(this)
      return width === null ? viewport : Math.max(1, Math.min(viewport, width))
    }
  }

  const originalFollowFingerMove = readerOptions.methods?.followFingerMove
  if (typeof originalFollowFingerMove === 'function') {
    readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
      originalFollowFingerMove.call(this, event)
      if (!gapPlan(this) || !(this.$el instanceof HTMLElement)) return
      const width = idlePaintedWidth(this)
      if (width === null) return
      const viewport = Math.max(1, this.$el.clientWidth || window.innerWidth)
      const span = Math.max(1, Math.min(viewport, width))
      this.drag.axisSize = span
      this.drag.offset = Math.max(-span, Math.min(span, this.drag.rawOffset))
    }
  }

  const originalShouldRenderCustomSpread = readerOptions.methods?.shouldRenderCustomSpread
  if (typeof originalShouldRenderCustomSpread === 'function') {
    readerOptions.methods.shouldRenderCustomSpread = function (this: any, spreadIndex: number): boolean {
      if (gapPlan(this)) return spreadIndex === this.drag.currentIndex
      return originalShouldRenderCustomSpread.call(this, spreadIndex)
    }
  }

  const originalCustomSpreadStyle = readerOptions.methods?.customSpreadStyle
  if (typeof originalCustomSpreadStyle === 'function') {
    readerOptions.methods.customSpreadStyle = function (this: any, spreadIndex: number): Record<string, string> {
      if (!gapPlan(this)) return originalCustomSpreadStyle.call(this, spreadIndex)
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

  const originalMeasurePageBounds = paperOptions.methods?.measurePageBounds
  if (typeof originalMeasurePageBounds === 'function') {
    paperOptions.methods.measurePageBounds = function (this: any): void {
      if (!gapPlan(this.$parent as any)) {
        originalMeasurePageBounds.call(this)
        return
      }
      measureGapBounds(this)
    }
  }

  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      const plan = gapPlan(this.$parent as any)
      if (!plan) return originalGeometry.call(this)
      return paperCurlDynamicGeometry(
        Math.min(localCurlProgress(plan, this.progress), 0.9998),
        this.touchCaptured ? this.touchStartY : 0.5,
        this.touchCaptured ? this.touchCurrentY : 0.5,
        this.direction,
        this.heightOverWidth,
      )
    }
  }

  const originalRender = paperOptions.render
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const reader = this.$parent as any
    const plan = gapPlan(reader)
    if (!plan) return originalRender.call(this, h) as VNode

    const currentSpread = reader.spreads?.[reader.drag.currentIndex] as PageDtoWithUrl[] | undefined
    const targetSpread = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined
    if (!currentSpread || !targetSpread) return originalRender.call(this, h) as VNode

    const progress = clamp01(this.progress)
    const mode = gapMode(plan)
    const curl = localCurlProgress(plan, progress)
    const direction = Math.sign(this.physicalDirection || -1)
    const ready = !!(this.pageBoundsReady && this.pageBounds)
    const width = ready
      ? Math.max(1, this.pageBounds.width)
      : Math.max(1, idlePaintedWidth(reader) || rootWidth(this))
    const targetPage = targetSpread[0]

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    const intoSlide = smooth(progress / INTO_BLANK_SLIDE_END)
    const intoSourceOpacity = mode === 'into-blank'
      ? 1 - smooth((intoSlide - 0.84) / 0.16)
      : 0
    const intoBlankOpacity = mode === 'into-blank'
      ? 1 - smooth((progress - INTO_BLANK_SLIDE_END) / PHASE_BLEND)
      : 0
    const intoTurningPresence = mode === 'into-blank'
      ? smooth((progress - (INTO_BLANK_SLIDE_END - PHASE_BLEND)) / (PHASE_BLEND * 2))
      : 1
    const intoSettle = mode === 'into-blank'
      ? smooth((progress - INTO_CURL_END) / (1 - INTO_CURL_END))
      : 0

    const outBlankHandoff = mode === 'out-blank'
      ? smooth((progress - OUT_BLANK_CURL_END) / (OUT_BLANK_HANDOFF_END - OUT_BLANK_CURL_END))
      : 0
    const outBlankSlide = mode === 'out-blank'
      ? smooth((progress - OUT_BLANK_HANDOFF_END) / (OUT_BLANK_SLIDE_END - OUT_BLANK_HANDOFF_END))
      : 0

    let turningOpacity = mode === 'into-blank'
      ? intoTurningPresence * (1 - intoSettle)
      : 1 - outBlankHandoff
    let finalOpacity = mode === 'into-blank' ? intoSettle : outBlankHandoff
    if (!ready) {
      turningOpacity = 0
      finalOpacity = 0
    }

    const sourceLayer = h('div', {
      key: 'gap-v1-source-slide',
      staticClass: 'paper-layer single-page-gap-v1-source-slide',
      style: {
        zIndex: '12',
        opacity: `${ready ? intoSourceOpacity : 0}`,
        transform: `translate3d(${direction * width * intoSlide}px, 0, 0)`,
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)])

    const blankStage = h('div', {
      key: 'gap-v1-blank-stage',
      staticClass: 'paper-layer single-page-gap-v1-blank-stage',
      style: {
        zIndex: '13',
        opacity: `${ready ? intoBlankOpacity : 0}`,
        transform: `translate3d(${-direction * width * (1 - intoSlide)}px, 0, 0)`,
        pointerEvents: 'none',
      },
    }, [h('div', {style: {...sourceRect(this), background: '#fff'}})])

    const targetUnder = targetUnderFace(plan, !!this.flipDirection, targetPage)
    const underTarget = targetUnder
      ? renderFace(
        h,
        targetUnder.face,
        {
          ...screenSlotRect(this, targetUnder.side),
          zIndex: '1',
          opacity: `${ready && mode === 'out-blank' ? turningOpacity : 0}`,
        },
        'single-page-gap-v1-under-target',
      )
      : emptyLayer(h, 'single-page-gap-v1-under-target')
    if (underTarget.data) underTarget.data.key = 'gap-v1-under-target'

    const leafRect = sourceRect(this)
    const turningGroup = h('div', {
      key: 'gap-v1-turning-group',
      staticClass: 'single-page-gap-v1-turning-group',
      style: {
        position: 'absolute',
        inset: '0',
        zIndex: '8',
        opacity: `${turningOpacity}`,
        transform: 'translate3d(0, 0, 0)',
        pointerEvents: 'none',
      },
    }, [
      h('div', {
        staticClass: 'paper-layer single-page-gap-v1-current',
        style: {
          position: 'absolute',
          inset: '0',
          zIndex: '4',
          ...(this.currentStyle as Record<string, string>),
        },
      }, [renderFace(h, plan.front, leafRect, 'single-page-gap-v1-front')]),
      h('div', {
        staticClass: 'paper-layer paper-back physical-comic-paper-back single-page-gap-v1-back',
        style: this.backStyle,
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: {
            ...(this.backContentStyle as Record<string, string>),
            filter: 'none',
          },
        }, [renderFace(h, plan.back, leafRect, 'single-page-gap-v1-back-face', true)]),
      ]),
      renderSafeCurlShadow(
        h,
        safeCreaseShadowStyle(this, curl),
        'single-page-gap-v1-safe-shadow',
      ),
      renderSafeCurlEdge(
        h,
        {
          ...(this.edgeStyle as Record<string, any>),
          opacity: `${Math.sin(curl * Math.PI)}`,
        },
        'single-page-gap-v1-safe-edge',
      ),
    ])

    const blankReturn = h('div', {
      key: 'gap-v1-blank-return',
      staticClass: 'paper-layer single-page-gap-v1-blank-return',
      style: {
        zIndex: '13',
        opacity: `${ready && mode === 'out-blank' ? outBlankHandoff * (1 - outBlankSlide) : 0}`,
        transform: `translate3d(${direction * width * outBlankSlide}px, 0, 0)`,
        pointerEvents: 'none',
      },
    }, [h('div', {style: {...centeredLeafRect(this), background: '#fff'}})])

    const targetTransform = mode === 'out-blank'
      ? `translate3d(${-direction * width * (1 - outBlankSlide)}px, 0, 0)`
      : 'translate3d(0, 0, 0)'
    const finalTarget = h('div', {
      key: 'gap-v1-final-target',
      staticClass: 'paper-layer single-page-gap-v1-final-target',
      style: {
        zIndex: '14',
        opacity: `${ready ? finalOpacity : 0}`,
        transform: targetTransform,
        pointerEvents: 'none',
      },
    }, [spread(targetSpread)])

    const bootstrap = h('div', {
      key: 'gap-v1-bootstrap',
      staticClass: 'paper-layer single-page-gap-v1-bootstrap',
      style: {
        position: 'absolute',
        inset: '0',
        zIndex: '20',
        opacity: `${ready ? 0 : 1}`,
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)])

    // Exactly one immutable .paper-current measurement surface, matching the
    // stable wide-state-machine invariant.
    const measurement = h('div', {
      key: 'gap-v1-measure',
      staticClass: 'paper-layer paper-current single-page-gap-v1-measure',
      style: {
        visibility: 'hidden',
        zIndex: '0',
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)])

    return h('div', {
      staticClass: 'paper-sheet single-page-gap-state-machine single-page-gap-v1',
      attrs: {'aria-hidden': 'true'},
      style: {
        overflow: 'visible',
        pointerEvents: 'none',
      },
    }, [
      measurement,
      bootstrap,
      sourceLayer,
      blankStage,
      underTarget,
      turningGroup,
      blankReturn,
      finalTarget,
    ])
  }
}
