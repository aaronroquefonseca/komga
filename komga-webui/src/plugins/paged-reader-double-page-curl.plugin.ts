import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalDoublePageLeafPlan,
  PhysicalPageFace,
  physicalDoublePageLeafPlan,
} from '@/functions/paged-reader-physical'
import {
  paperCurlDynamicGeometry,
  paperCurlReflectionMatrix,
} from '@/functions/paged-reader-transition'
import {PageDtoWithUrl} from '@/types/komga-books'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function isDoublePageLayout(layout: PagedReaderLayout): boolean {
  return layout === PagedReaderLayout.DOUBLE_PAGES || layout === PagedReaderLayout.DOUBLE_NO_COVER
}

type DoublePageSheetPlan = {
  plan: PhysicalDoublePageLeafPlan
  effect: PagedReaderTransition.PAGE_TURN | PagedReaderTransition.PAPER_CURL
  physicalComic: boolean
}

function sheetEffect(reader: any): PagedReaderTransition.PAGE_TURN | PagedReaderTransition.PAPER_CURL | null {
  if (!reader) return null
  if (reader.transition === PagedReaderTransition.PHYSICAL_COMIC) {
    const effective = typeof reader.effectiveTransition === 'function'
      ? reader.effectiveTransition()
      : PagedReaderTransition.PAPER_CURL
    return effective === PagedReaderTransition.PAPER_CURL
      ? PagedReaderTransition.PAPER_CURL
      : null
  }
  if (reader.transition === PagedReaderTransition.PAGE_TURN) return PagedReaderTransition.PAGE_TURN
  if (reader.transition === PagedReaderTransition.PAPER_CURL) return PagedReaderTransition.PAPER_CURL
  return null
}

function readerSheetPlan(reader: any): PhysicalDoublePageLeafPlan | null {
  if (!reader ||
    reader.vertical ||
    !isDoublePageLayout(reader.pageLayout) ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null ||
    reader.drag.navigationDelta === 0 ||
    sheetEffect(reader) === null) return null

  return physicalDoublePageLeafPlan(
    reader.spreads?.[reader.drag.currentIndex],
    reader.spreads?.[reader.drag.targetIndex],
    reader.drag.navigationDelta,
    !!reader.flipDirection,
  )
}

/**
 * All sheet-like double-page effects share the same physical A|B -> C|D leaf
 * topology. Physical Comic chooses Paper Curl dynamically; standalone Page Turn
 * and Paper Curl use their selected effect directly.
 */
function sheetPlan(sheet: any): DoublePageSheetPlan | null {
  const parent = sheet.$parent as any
  const effect = sheetEffect(parent)
  if (effect === null) return null
  const plan = readerSheetPlan(parent)
  if (!plan) return null
  return {
    plan,
    effect,
    physicalComic: parent.transition === PagedReaderTransition.PHYSICAL_COMIC,
  }
}

function curlPlan(sheet: any): DoublePageSheetPlan | null {
  const resolved = sheetPlan(sheet)
  return resolved?.effect === PagedReaderTransition.PAPER_CURL ? resolved : null
}

type HorizontalRect = {
  left: number
  right: number
  width: number
}

function paintedImageHorizontalRect(image: HTMLImageElement): HorizontalRect | null {
  const rect = image.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return {left: rect.left, right: rect.right, width: rect.width}
  }
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const width = naturalWidth * scale
  const left = rect.left + (rect.width - width) / 2
  return {left, right: left + width, width}
}

/** The hidden layout anchor is never transformed, so it is the stable source of
 * the complete open-book painted width during both live drag and settlement. */
function openBookPaintedWidth(reader: any): number | null {
  if (!(reader.$el instanceof HTMLElement)) return null
  const anchor = reader.$el.querySelector('.custom-layout-anchor')
  if (!(anchor instanceof HTMLElement)) return null
  const rects = Array.from(anchor.querySelectorAll('img'))
    .map(image => paintedImageHorizontalRect(image as HTMLImageElement))
    .filter((rect): rect is HorizontalRect => rect !== null)
  if (rects.length === 0) return null
  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  return Math.max(1, right - left)
}

function doubleSheetGestureSpan(reader: any, viewportSpan: number): number | null {
  if (!readerSheetPlan(reader)) return null
  const width = openBookPaintedWidth(reader)
  return width === null ? null : Math.max(1, Math.min(viewportSpan, width))
}

/**
 * pageBounds is measured from the turning front artwork. For a normal face the
 * measured width already is one leaf. A virtual half of a wide source renders
 * the source at two leaf widths, so halve the measurement before snapping its
 * bound edge to the center spine.
 */
function anchorPageBoundsToSpine(sheet: any): void {
  const resolved = sheetPlan(sheet)
  if (!resolved ||
    !sheet.pageBoundsReady ||
    !sheet.pageBounds ||
    !(sheet.$el instanceof HTMLElement)) return

  const {top, width: measuredWidth, height} = sheet.pageBounds
  if (![top, measuredWidth, height].every(Number.isFinite) || measuredWidth <= 0 || height <= 0) return

  const rootRect = (sheet.$el as HTMLElement).getBoundingClientRect()
  if (rootRect.width <= 0) return

  const width = resolved.plan.front.crop === 'full' ? measuredWidth : measuredWidth / 2
  const direction = Math.sign(sheet.physicalDirection || -1)
  const startsRight = direction < 0
  const spine = rootRect.width / 2
  const left = startsRight ? spine : spine - width

  sheet.pageBounds = {
    ...sheet.pageBounds,
    left,
    width,
  }
  sheet.heightOverWidth = height / Math.max(1, width)
}

function openBookClip(sheet: any, startsRight: boolean): string | null {
  if (!sheet.pageBoundsReady || !sheet.pageBounds) return null
  const {left, top, width, height} = sheet.pageBounds
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  const bookLeft = startsRight ? left - width : left
  const bookRight = startsRight ? left + width : left + width * 2
  const bottom = top + height
  return `polygon(${bookLeft}px ${top}px, ${bookRight}px ${top}px, ${bookRight}px ${bottom}px, ${bookLeft}px ${bottom}px)`
}

function leafFaceStyle(sheet: any, startsRight: boolean): Record<string, string> {
  const common: Record<string, string> = {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
  }
  if (sheet.pageBoundsReady && sheet.pageBounds) {
    const {left, top, width, height} = sheet.pageBounds
    if ([left, top, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      return {
        ...common,
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }
    }
  }
  return {
    ...common,
    left: startsRight ? '50%' : '0',
    top: '0',
    width: '50%',
    height: '100%',
  }
}

function bookFaceStyle(
  sheet: any,
  startsRight: boolean,
  side: 'left' | 'right',
): Record<string, string> {
  const common: Record<string, string> = {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
  }
  if (sheet.pageBoundsReady && sheet.pageBounds) {
    const {left, top, width, height} = sheet.pageBounds
    if ([left, top, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      const spine = startsRight ? left : left + width
      return {
        ...common,
        left: `${side === 'left' ? spine - width : spine}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }
    }
  }
  return {
    ...common,
    left: side === 'left' ? '0' : '50%',
    top: '0',
    width: '50%',
    height: '100%',
  }
}

function leafContainerStyle(
  sheet: any,
  startsRight: boolean,
  transform: string,
): Record<string, string> {
  const rect = leafFaceStyle(sheet, startsRight)
  return {
    ...rect,
    overflow: 'visible',
    transformOrigin: startsRight ? 'left center' : 'right center',
    transform,
    transformStyle: 'preserve-3d',
    willChange: 'transform',
    zIndex: '6',
  }
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
): VNode {
  // Existing double-page placeholders have a real opaque-white data URL. Keep
  // that image in the DOM even though page.number === 0: it is also our exact
  // measurement surface when the blank sheet itself is the turning front.
  return h('div', {
    staticClass,
    style: {...style, background: '#fff'},
  }, !face.page.url ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: faceImageStyle(face),
    }),
  ])
}

function alignedBackContentStyle(sheet: any): Record<string, string> {
  if (!sheet.pageBoundsReady || !sheet.pageBounds) return {opacity: '0'}
  const {left, top, width, height} = sheet.pageBounds
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return {opacity: '0'}
  const {seamTop, seamBottom} = sheet.geometry
  const bottom = top + height
  const reflection = paperCurlReflectionMatrix(
    {x: sheet.paperX(seamTop), y: top},
    {x: sheet.paperX(seamBottom), y: bottom},
  )
  const centreX = left + width / 2
  return {
    transformOrigin: '0 0',
    transform: `matrix(${-reflection.a}, ${-reflection.b}, ${reflection.c}, ${reflection.d}, ${reflection.e + 2 * centreX * reflection.a}, ${reflection.f + 2 * centreX * reflection.b})`,
    opacity: '1',
    filter: 'none',
  }
}

function renderBase(
  sheet: any,
  h: CreateElement,
  plan: PhysicalDoublePageLeafPlan,
  startsRight: boolean,
  classPrefix: string,
): VNode {
  const baseLeft = sheet.flipDirection ? plan.baseFaces[1] : plan.baseFaces[0]
  const baseRight = sheet.flipDirection ? plan.baseFaces[0] : plan.baseFaces[1]
  return h('div', {
    staticClass: `paper-layer ${classPrefix}-base`,
    style: {zIndex: '1'},
  }, [
    renderFace(h, baseLeft, bookFaceStyle(sheet, startsRight, 'left'), `${classPrefix}-base-face ${classPrefix}-base-left`),
    renderFace(h, baseRight, bookFaceStyle(sheet, startsRight, 'right'), `${classPrefix}-base-face ${classPrefix}-base-right`),
  ])
}

function renderDirectionHandoffCover(sheet: any, h: CreateElement): VNode {
  const reader = sheet.$parent as any
  return h('div', {
    key: 'double-page-direction-cover',
    staticClass: 'paper-layer double-page-direction-cover',
    style: {
      position: 'absolute',
      inset: '0',
      zIndex: '20',
      opacity: reader?.drag?.tracking && reader.__doublePageDirectionCover ? '1' : '0',
      pointerEvents: 'none',
      filter: 'none',
      willChange: 'auto',
      contain: 'none',
      isolation: 'auto',
    },
  }, [
    h('paged-reader-spread', {
      props: {
        spread: sheet.frontSpread,
        flipDirection: sheet.flipDirection,
        scale: sheet.scale,
      },
    }),
  ])
}

function renderPageTurn(
  sheet: any,
  h: CreateElement,
  resolved: DoublePageSheetPlan,
  startsRight: boolean,
): VNode {
  const progress = clamp01(sheet.progress)
  const direction = Math.sign(sheet.physicalDirection || -1)
  const arch = Math.sin(progress * Math.PI)
  const verticalDelta = sheet.touchCaptured ? sheet.touchCurrentY - sheet.touchStartY : 0
  const angle = direction * progress * 180
  const cornerTilt = verticalDelta * 8 * arch
  const lift = arch * 8
  const leafTransform = `perspective(1800px) translateZ(${lift}px) rotateY(${angle}deg) rotateZ(${cornerTilt}deg)`

  const faceStyle: Record<string, string> = {
    position: 'absolute',
    inset: '0',
    display: 'block',
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    background: '#fff',
  }
  const frontStyle = {
    ...faceStyle,
    filter: `drop-shadow(${direction * 9}px 0 ${8 + arch * 12}px rgba(0,0,0,${0.14 + arch * 0.18}))`,
  }
  const backStyle = {
    ...faceStyle,
    transform: 'rotateY(180deg)',
    filter: `drop-shadow(${-direction * 7}px 0 ${6 + arch * 10}px rgba(0,0,0,${0.10 + arch * 0.14}))`,
  }

  const clip = openBookClip(sheet, startsRight)
  const rootStyle: Record<string, string> = {overflow: 'visible'}
  if (clip) {
    rootStyle.clipPath = clip
    rootStyle.WebkitClipPath = clip
  }

  return h('div', {
    staticClass: 'paper-sheet double-page-page-turn-sheet',
    attrs: {'aria-hidden': 'true'},
    style: rootStyle,
  }, [
    renderBase(sheet, h, resolved.plan, startsRight, 'double-page-page-turn'),
    h('div', {
      staticClass: 'paper-layer paper-current double-page-page-turn-measure',
      style: {visibility: 'hidden', zIndex: '0'},
    }, [
      renderFace(h, resolved.plan.front, leafFaceStyle(sheet, startsRight), 'double-page-page-turn-measure-face'),
    ]),
    h('div', {
      staticClass: 'double-page-page-turn-leaf',
      style: leafContainerStyle(sheet, startsRight, leafTransform),
    }, [
      renderFace(h, resolved.plan.front, frontStyle, 'double-page-page-turn-front'),
      renderFace(h, resolved.plan.back, backStyle, 'double-page-page-turn-back'),
    ]),
    renderDirectionHandoffCover(sheet, h),
  ])
}

function renderPaperCurl(
  sheet: any,
  h: CreateElement,
  resolved: DoublePageSheetPlan,
  startsRight: boolean,
): VNode {
  const sourceStyle = leafFaceStyle(sheet, startsRight)
  const clip = openBookClip(sheet, startsRight)
  const rootStyle: Record<string, string> = {overflow: 'hidden'}
  if (clip) {
    rootStyle.clipPath = clip
    rootStyle.WebkitClipPath = clip
  }

  return h('div', {
    staticClass: resolved.physicalComic
      ? 'paper-sheet double-page-physical-curl'
      : 'paper-sheet double-page-paper-curl',
    attrs: {'aria-hidden': 'true'},
    style: rootStyle,
  }, [
    renderBase(sheet, h, resolved.plan, startsRight, resolved.physicalComic ? 'double-page-curl' : 'double-page-paper-curl'),
    h('div', {
      staticClass: 'paper-layer paper-current double-page-curl-current',
      style: sheet.currentStyle,
    }, [
      renderFace(h, resolved.plan.front, sourceStyle, 'double-page-curl-face double-page-curl-front-face'),
    ]),
    h('div', {
      staticClass: resolved.physicalComic
        ? 'paper-layer paper-back physical-comic-paper-back double-page-curl-back'
        : 'paper-layer paper-back double-page-curl-back',
      style: sheet.backStyle,
    }, [
      h('div', {
        staticClass: 'paper-back-content',
        style: alignedBackContentStyle(sheet),
      }, [
        renderFace(h, resolved.plan.back, sourceStyle, 'double-page-curl-face double-page-curl-back-face'),
      ]),
    ]),
    h('div', {staticClass: 'paper-shadow', style: sheet.shadowStyle}),
    h('div', {staticClass: 'paper-edge', style: sheet.edgeStyle}),
    renderDirectionHandoffCover(sheet, h),
  ])
}

/**
 * Shared double-page physical-sheet compositor.
 *
 * - Physical Comic and standalone Paper Curl use the polished two-point curl.
 * - Page Turn keeps its rigid 3D character, but turns one measured leaf instead
 *   of the entire spread.
 * - Normal two-page spreads, wide scans and synthetic white slots all use the
 *   same visual-face planner and painted-book gesture distance.
 */
export function installDoublePagePhysicalCurl(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__doublePagePhysicalCurlInstalled) return
  paperOptions.__doublePagePhysicalCurlInstalled = true

  const originalDoublePageLeafTransition = readerOptions?.computed?.doublePageLeafTransition
  if (typeof originalDoublePageLeafTransition === 'function') {
    readerOptions.computed.doublePageLeafTransition = function (this: any): boolean {
      const sheetLike = this.transition === PagedReaderTransition.PHYSICAL_COMIC ||
        this.transition === PagedReaderTransition.PAGE_TURN ||
        this.transition === PagedReaderTransition.PAPER_CURL
      if (sheetLike &&
        !this.vertical &&
        isDoublePageLayout(this.pageLayout) &&
        this.drag?.prepared &&
        this.drag.targetIndex !== null &&
        this.drag.navigationDelta !== 0) {
        const plan = physicalDoublePageLeafPlan(
          this.spreads?.[this.drag.currentIndex],
          this.spreads?.[this.drag.targetIndex],
          this.drag.navigationDelta,
          !!this.flipDirection,
        )
        if (plan) return true
      }
      return originalDoublePageLeafTransition.call(this)
    }
  }

  const originalMeasureAxisSize = readerOptions?.methods?.measureAxisSize
  if (typeof originalMeasureAxisSize === 'function') {
    readerOptions.methods.measureAxisSize = function (this: any, root: HTMLElement): number {
      const fallback = originalMeasureAxisSize.call(this, root)
      const viewportSpan = Math.max(1, root.clientWidth || window.innerWidth)
      return doubleSheetGestureSpan(this, viewportSpan) ?? fallback
    }
  }

  const originalFollowFingerMove = readerOptions?.methods?.followFingerMove
  if (typeof originalFollowFingerMove === 'function') {
    readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
      originalFollowFingerMove.call(this, event)
      if (!(this.$el instanceof HTMLElement) || !readerSheetPlan(this)) return
      const viewportSpan = Math.max(1, this.$el.clientWidth || window.innerWidth)
      const span = doubleSheetGestureSpan(this, viewportSpan)
      if (span === null) return
      this.drag.axisSize = span
      this.drag.offset = Math.max(-span, Math.min(span, this.drag.rawOffset))
    }
  }

  const originalMeasurePageBounds = paperOptions.methods?.measurePageBounds
  if (typeof originalMeasurePageBounds === 'function') {
    paperOptions.methods.measurePageBounds = function (this: any): void {
      originalMeasurePageBounds.call(this)
      anchorPageBoundsToSpine(this)
    }
  }

  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      if (!curlPlan(this)) return originalGeometry.call(this)
      return paperCurlDynamicGeometry(
        Math.min(clamp01(this.progress), 0.9998),
        this.touchCaptured ? this.touchStartY : 0.5,
        this.touchCaptured ? this.touchCurrentY : 0.5,
        this.direction,
        this.heightOverWidth,
      )
    }
  }

  const originalRender = paperOptions.render
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const resolved = sheetPlan(this)
    if (!resolved) return originalRender.call(this, h) as VNode
    const startsRight = Math.sign(this.physicalDirection || -1) < 0
    return resolved.effect === PagedReaderTransition.PAGE_TURN
      ? renderPageTurn(this, h, resolved, startsRight)
      : renderPaperCurl(this, h, resolved, startsRight)
  }
}
