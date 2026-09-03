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

const INTO_BLANK_SLIDE_END = 0.30
const INTO_CURL_END = 0.90
const OUT_BLANK_CURL_END = 0.56
const OUT_BLANK_HANDOFF_END = 0.62
const OUT_BLANK_SLIDE_END = 0.90
const DIRECT_CURL_END = 0.90
const DIRECT_PEEL_MAX = 0.49
const PHASE_BLEND = 0.025

type WideTransitionMode =
  | 'into-direct'
  | 'into-blank'
  | 'out-direct'
  | 'out-blank'

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

function transitionPlan(reader: any): PhysicalSinglePageEdgePlan | null {
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

  if (!plan || plan.kind !== 'curl' || plan.currentWide === plan.targetWide) return null
  return plan
}

function transitionMode(plan: PhysicalSinglePageEdgePlan): WideTransitionMode {
  if (!plan.currentWide && plan.targetWide) {
    return plan.crossesSyntheticBlank ? 'into-blank' : 'into-direct'
  }
  return plan.crossesSyntheticBlank ? 'out-blank' : 'out-direct'
}

function faceSide(face: PhysicalPageFace): 'left' | 'right' | null {
  if (face.crop === 'left') return 'left'
  if (face.crop === 'right') return 'right'
  return null
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

function idlePaintedRect(reader: any): PaintedRect | null {
  if (!(reader?.$el instanceof HTMLElement)) return null
  const anchor = reader.$el.querySelector('.custom-layout-anchor')
  if (!(anchor instanceof HTMLElement)) return null

  const rects = Array.from(anchor.querySelectorAll('img'))
    .map(image => paintedImageRect(image as HTMLImageElement))
    .filter((rect): rect is PaintedRect => rect !== null)
  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.left))
  const top = Math.min(...rects.map(rect => rect.top))
  const right = Math.max(...rects.map(rect => rect.right))
  const bottom = Math.max(...rects.map(rect => rect.bottom))
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function rootRect(sheet: any): DOMRect | null {
  return sheet.$el instanceof HTMLElement ? sheet.$el.getBoundingClientRect() : null
}

function rootWidth(sheet: any): number {
  const rect = rootRect(sheet)
  return rect && rect.width > 0 ? rect.width : Math.max(1, window.innerWidth)
}

function gestureWidth(reader: any, plan: PhysicalSinglePageEdgePlan): number | null {
  const idle = idlePaintedRect(reader)
  if (!idle) return null
  return Math.max(1, plan.currentWide ? idle.width / 2 : idle.width)
}

/**
 * The V2 compositor has exactly one .paper-current measurement surface. Never
 * let a visible curled face participate in PagedReaderPaperSheet's measurement
 * query: unioning those two rectangles was the main source of unstable geometry
 * in the first unified state machine.
 */
function measureOwnedBounds(sheet: any, plan: PhysicalSinglePageEdgePlan): void {
  if (!(sheet.$el instanceof HTMLElement)) return
  const root = sheet.$el as HTMLElement
  const rootBounds = root.getBoundingClientRect()
  const images = Array.from(root.querySelectorAll('.single-page-wide-v2-measure img')) as HTMLImageElement[]
  const rects = images
    .map(paintedImageRect)
    .filter((rect): rect is PaintedRect => rect !== null)

  if (rects.length === 0) {
    sheet.pageBoundsReady = false
    return
  }

  const paintedLeft = Math.min(...rects.map(rect => rect.left))
  const paintedTop = Math.min(...rects.map(rect => rect.top))
  const paintedRight = Math.max(...rects.map(rect => rect.right))
  const paintedBottom = Math.max(...rects.map(rect => rect.bottom))

  let width = Math.max(1, paintedRight - paintedLeft)
  const height = Math.max(1, paintedBottom - paintedTop)
  const top = paintedTop - rootBounds.top
  let left = paintedLeft - rootBounds.left

  if (plan.currentWide) {
    width = Math.max(1, width / 2)
    const spine = rootBounds.width / 2
    const side = faceSide(plan.front)
    left = side === 'left' ? spine - width : spine
  }

  sheet.pageBounds = {left, top, width, height}
  sheet.pageBoundsReady = true
  sheet.heightOverWidth = height / width
  if (typeof sheet.syncTouchGeometry === 'function') sheet.syncTouchGeometry()
}

/**
 * A direction change keeps the same wide source image, so none of the paper
 * sheet's image/prop watchers schedule a new measurement. Re-anchor the already
 * measured half synchronously: clip/reflection geometry must never render with
 * the previous virtual half's rectangle.
 */
export function anchorWideSourceBounds(
  sheet: any,
  plan: Pick<PhysicalSinglePageEdgePlan, 'currentWide' | 'front'>,
): void {
  if (!plan.currentWide || !sheet.pageBoundsReady || !sheet.pageBounds) return
  const side = faceSide(plan.front)
  if (!side) return

  const width = Number(sheet.pageBounds.width)
  if (!Number.isFinite(width) || width <= 0) return
  const spine = rootWidth(sheet) / 2
  const left = side === 'left' ? spine - width : spine
  if (Math.abs(Number(sheet.pageBounds.left) - left) <= 0.01) return

  sheet.pageBounds = {
    ...sheet.pageBounds,
    left,
  }
}

function localCurlProgress(plan: PhysicalSinglePageEdgePlan, progress: number): number {
  const p = clamp01(progress)
  switch (transitionMode(plan)) {
    case 'into-blank':
      return clamp01((p - INTO_BLANK_SLIDE_END) / (INTO_CURL_END - INTO_BLANK_SLIDE_END))
    case 'into-direct':
      return clamp01(p / DIRECT_CURL_END) * DIRECT_PEEL_MAX
    case 'out-blank':
      return clamp01(p / OUT_BLANK_CURL_END)
    case 'out-direct':
      return clamp01(p / DIRECT_CURL_END)
  }
  return 0
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
      style: faceImageStyle(face),
    }),
  ]

  return h('div', {
    staticClass,
    style: {
      ...style,
      background: '#fff',
    },
  }, readableBack ? [
    h('div', {
      staticClass: 'single-page-wide-v2-readable-back-artwork',
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
  const bounds = sheet.pageBounds
  if (sheet.pageBoundsReady && bounds) {
    return {
      position: 'absolute',
      display: 'block',
      overflow: 'hidden',
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
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

function outerEdgeSlotRect(sheet: any, side: 'left' | 'right'): Record<string, string> {
  if (!sheet.pageBoundsReady || !sheet.pageBounds) return screenSlotRect(sheet, side)
  const {top, width, height} = sheet.pageBounds
  const viewportWidth = rootWidth(sheet)
  return {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
    left: `${side === 'left' ? 0 : viewportWidth - width}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
}

function stationaryTargetFace(plan: PhysicalSinglePageEdgePlan): PhysicalPageFace | null {
  return plan.targetFaces.find(face => face.crop !== plan.back.crop) || null
}

function stationaryCurrentFace(plan: PhysicalSinglePageEdgePlan): PhysicalPageFace | null {
  return plan.currentFaces.find(face => face.crop !== plan.front.crop) || null
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
 * Unified portrait <-> wide Physical Comic compositor, version 2.
 *
 * The important invariant is structural: once a transition starts, the same
 * layer tree remains mounted until it ends. Phase boundaries only change
 * opacity/transform. This avoids stale raster tiles when Android/Chromium has to
 * composite clip-path + transformed image layers while a subtree is removed or
 * introduced in the middle of a curl.
 */
export function installSinglePageWideStateMachine(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || readerOptions.__singlePageWideStateMachineInstalled) return
  readerOptions.__singlePageWideStateMachineInstalled = true

  const originalDuration = readerOptions.computed?.transitionDuration
  if (typeof originalDuration === 'function') {
    readerOptions.computed.transitionDuration = function (this: any): number {
      const plan = transitionPlan(this)
      if (!plan) return originalDuration.call(this)
      return plan.crossesSyntheticBlank ? 430 : 370
    }
  }

  const originalMeasureAxisSize = readerOptions.methods?.measureAxisSize
  if (typeof originalMeasureAxisSize === 'function') {
    readerOptions.methods.measureAxisSize = function (this: any, root: HTMLElement): number {
      const plan = transitionPlan(this)
      if (!plan) return originalMeasureAxisSize.call(this, root)
      const width = gestureWidth(this, plan)
      const viewport = Math.max(1, root.clientWidth || window.innerWidth)
      return width === null ? viewport : Math.max(1, Math.min(viewport, width))
    }
  }

  const originalFollowFingerMove = readerOptions.methods?.followFingerMove
  if (typeof originalFollowFingerMove === 'function') {
    readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
      originalFollowFingerMove.call(this, event)
      const plan = transitionPlan(this)
      if (!plan || !(this.$el instanceof HTMLElement)) return
      const width = gestureWidth(this, plan)
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
      if (transitionPlan(this)) return spreadIndex === this.drag.currentIndex
      return originalShouldRenderCustomSpread.call(this, spreadIndex)
    }
  }

  const originalCustomSpreadStyle = readerOptions.methods?.customSpreadStyle
  if (typeof originalCustomSpreadStyle === 'function') {
    readerOptions.methods.customSpreadStyle = function (this: any, spreadIndex: number): Record<string, string> {
      if (!transitionPlan(this)) return originalCustomSpreadStyle.call(this, spreadIndex)
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
      const plan = transitionPlan(this.$parent as any)
      if (!plan) {
        originalMeasurePageBounds.call(this)
        return
      }
      measureOwnedBounds(this, plan)
    }
  }

  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      const plan = transitionPlan(this.$parent as any)
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
    const plan = transitionPlan(reader)
    if (!plan) return originalRender.call(this, h) as VNode

    anchorWideSourceBounds(this, plan)

    const currentSpread = reader.spreads?.[reader.drag.currentIndex] as PageDtoWithUrl[] | undefined
    const targetSpread = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined
    if (!currentSpread || !targetSpread) return originalRender.call(this, h) as VNode

    const progress = clamp01(this.progress)
    const mode = transitionMode(plan)
    const curl = localCurlProgress(plan, progress)
    const direction = Math.sign(this.physicalDirection || -1)
    const ready = !!(this.pageBoundsReady && this.pageBounds)
    const width = ready ? Math.max(1, this.pageBounds.width) : Math.max(1, gestureWidth(reader, plan) || rootWidth(this) / 2)
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
    const intoSettle = mode === 'into-direct' || mode === 'into-blank'
      ? smooth((progress - INTO_CURL_END) / (1 - INTO_CURL_END))
      : 0

    const outBlankHandoff = mode === 'out-blank'
      ? smooth((progress - OUT_BLANK_CURL_END) / (OUT_BLANK_HANDOFF_END - OUT_BLANK_CURL_END))
      : 0
    const outBlankSlide = mode === 'out-blank'
      ? smooth((progress - OUT_BLANK_HANDOFF_END) / (OUT_BLANK_SLIDE_END - OUT_BLANK_HANDOFF_END))
      : 0
    const outDirectHandoff = mode === 'out-direct'
      ? smooth((progress - DIRECT_CURL_END) / (1 - DIRECT_CURL_END))
      : 0

    let turningOpacity = 0
    let finalOpacity = 0
    if (mode === 'into-direct' || mode === 'into-blank') {
      turningOpacity = intoTurningPresence * (1 - intoSettle)
      finalOpacity = intoSettle
    } else if (mode === 'out-blank') {
      turningOpacity = 1 - outBlankHandoff
      finalOpacity = outBlankHandoff
    } else {
      turningOpacity = 1 - outDirectHandoff
      finalOpacity = outDirectHandoff
    }
    if (!ready) turningOpacity = 0

    const stationaryTarget = stationaryTargetFace(plan)
    const stationaryCurrent = stationaryCurrentFace(plan)
    const targetUnder = targetUnderFace(plan, !!this.flipDirection, targetPage)

    const sourceLayer = h('div', {
      key: 'wide-v2-source-slide',
      staticClass: 'paper-layer single-page-wide-v2-source-slide',
      style: {
        zIndex: '12',
        opacity: `${ready ? intoSourceOpacity : 0}`,
        transform: `translate3d(${direction * width * intoSlide}px, 0, 0)`,
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)])

    const blankStage = h('div', {
      key: 'wide-v2-blank-stage',
      staticClass: 'paper-layer single-page-wide-v2-blank-stage',
      style: {
        zIndex: '13',
        opacity: `${ready ? intoBlankOpacity : 0}`,
        transform: `translate3d(${-direction * width * (1 - intoSlide)}px, 0, 0)`,
        pointerEvents: 'none',
      },
    }, [h('div', {style: {...sourceRect(this), background: '#fff'}})])

    const underCurrent = stationaryCurrent
      ? renderFace(
        h,
        stationaryCurrent,
        {
          ...screenSlotRect(this, faceSide(stationaryCurrent) || 'left'),
          zIndex: '2',
          opacity: `${ready && (mode === 'out-direct' || mode === 'out-blank') ? turningOpacity : 0}`,
        },
        'single-page-wide-v2-under-current',
      )
      : emptyLayer(h, 'single-page-wide-v2-under-current')
    if (underCurrent.data) underCurrent.data.key = 'wide-v2-under-current'

    const underWide = stationaryTarget
      ? renderFace(
        h,
        stationaryTarget,
        {
          ...outerEdgeSlotRect(this, faceSide(stationaryTarget) || 'right'),
          zIndex: '2',
          opacity: `${ready && (mode === 'into-direct' || mode === 'into-blank')
            ? (1 - intoSettle) * smooth(curl / 0.35)
            : 0}`,
        },
        'single-page-wide-v2-under-target-wide',
      )
      : emptyLayer(h, 'single-page-wide-v2-under-target-wide')
    if (underWide.data) underWide.data.key = 'wide-v2-under-target-wide'

    const underSingle = targetUnder
      ? renderFace(
        h,
        targetUnder.face,
        {
          ...screenSlotRect(this, targetUnder.side),
          zIndex: '1',
          opacity: `${ready && mode === 'out-blank' ? turningOpacity : 0}`,
        },
        'single-page-wide-v2-under-target-single',
      )
      : emptyLayer(h, 'single-page-wide-v2-under-target-single')
    if (underSingle.data) underSingle.data.key = 'wide-v2-under-target-single'

    const leafRect = sourceRect(this)
    const turningGroup = h('div', {
      key: 'wide-v2-turning-group',
      staticClass: 'single-page-wide-v2-turning-group',
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
        staticClass: 'paper-layer single-page-wide-v2-current',
        style: {
          position: 'absolute',
          inset: '0',
          zIndex: '4',
          ...(this.currentStyle as Record<string, string>),
        },
      }, [renderFace(h, plan.front, leafRect, 'single-page-wide-v2-front')]),
      h('div', {
        staticClass: 'paper-layer paper-back physical-comic-paper-back single-page-wide-v2-back',
        style: this.backStyle,
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: {
            ...(this.backContentStyle as Record<string, string>),
            filter: 'none',
          },
        }, [renderFace(h, plan.back, leafRect, 'single-page-wide-v2-back-face', true)]),
      ]),
      h('div', {staticClass: 'paper-shadow', style: this.shadowStyle}),
      h('div', {staticClass: 'paper-edge', style: this.edgeStyle}),
    ])

    const blankReturn = h('div', {
      key: 'wide-v2-blank-return',
      staticClass: 'paper-layer single-page-wide-v2-blank-return',
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
      key: 'wide-v2-final-target',
      staticClass: 'paper-layer single-page-wide-v2-final-target',
      style: {
        zIndex: '14',
        opacity: `${ready ? finalOpacity : 0}`,
        transform: targetTransform,
        pointerEvents: 'none',
      },
    }, [spread(targetSpread)])

    const bootstrap = h('div', {
      key: 'wide-v2-bootstrap',
      staticClass: 'paper-layer single-page-wide-v2-bootstrap',
      style: {
        position: 'absolute',
        inset: '0',
        zIndex: '20',
        opacity: `${ready ? 0 : 1}`,
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)])

    // This is the only .paper-current node in the entire V2 tree. It never
    // changes identity or artwork while the transition is alive.
    const measurement = h('div', {
      key: 'wide-v2-measure',
      staticClass: 'paper-layer paper-current single-page-wide-v2-measure',
      style: {
        visibility: 'hidden',
        zIndex: '0',
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)])

    return h('div', {
      staticClass: 'paper-sheet single-page-wide-state-machine single-page-wide-v2',
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
      underCurrent,
      underWide,
      underSingle,
      turningGroup,
      blankReturn,
      finalTarget,
    ])
  }
}
