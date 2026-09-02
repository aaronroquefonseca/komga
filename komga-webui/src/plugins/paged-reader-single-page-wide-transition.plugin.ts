import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalPageFace,
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'
import {
  paperCurlDynamicGeometry,
  paperCurlReflectionMatrix,
} from '@/functions/paged-reader-transition'
import {PageDtoWithUrl} from '@/types/komga-books'

const BLANK_SLIDE_END = 0.30
const CURL_END = 0.90

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/** Only the two forward portrait -> wide cases owned by this final compositor. */
function intoWidePlan(reader: any): PhysicalSinglePageEdgePlan | null {
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
    plan.direction <= 0 ||
    plan.currentWide ||
    !plan.targetWide) return null
  return plan
}

function sheetPlan(sheet: any): PhysicalSinglePageEdgePlan | null {
  return intoWidePlan(sheet.$parent as any)
}

function rootWidth(sheet: any): number {
  if (sheet.$el instanceof HTMLElement) {
    const width = sheet.$el.getBoundingClientRect().width
    if (width > 0) return width
  }
  return Math.max(1, window.innerWidth)
}

type HorizontalRect = {
  left: number
  right: number
  width: number
}

function paintedHorizontalRect(image: HTMLImageElement): HorizontalRect | null {
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

/**
 * The invisible normal-flow anchor always contains the current idle source and
 * never participates in transition overlays. It therefore gives us a stable
 * gesture span even while the visible renderer switches between slide/curl
 * phases. This prevents follow-finger progress from changing under its own feet.
 */
function stableCurrentWidth(reader: any): number | null {
  if (!(reader.$el instanceof HTMLElement)) return null
  const anchor = reader.$el.querySelector('.custom-layout-anchor')
  if (!(anchor instanceof HTMLElement)) return null

  const rects = Array.from(anchor.querySelectorAll('img'))
    .map(image => paintedHorizontalRect(image as HTMLImageElement))
    .filter((rect): rect is HorizontalRect => rect !== null)
  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  return Math.max(1, right - left)
}

function localCurlProgress(plan: PhysicalSinglePageEdgePlan, progress: number): number {
  const p = clamp01(progress)
  if (plan.crossesSyntheticBlank) {
    return clamp01((p - BLANK_SLIDE_END) / (CURL_END - BLANK_SLIDE_END))
  }
  return clamp01(p / CURL_END)
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

function isBlank(face: PhysicalPageFace): boolean {
  return face.page.number <= 0 || !face.page.url
}

function renderFace(
  h: CreateElement,
  face: PhysicalPageFace,
  style: Record<string, string>,
  staticClass: string,
): VNode {
  return h('div', {
    staticClass,
    style: {
      ...style,
      background: '#fff',
    },
  }, isBlank(face) ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: faceImageStyle(face),
    }),
  ])
}

function sourceRect(sheet: any): Record<string, string> {
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

function faceSide(face: PhysicalPageFace): 'left' | 'right' | null {
  if (face.crop === 'left') return 'left'
  if (face.crop === 'right') return 'right'
  return null
}

function stationaryTargetFace(plan: PhysicalSinglePageEdgePlan): PhysicalPageFace | null {
  for (const face of plan.baseFaces) {
    if (!face) continue
    if (face.page !== plan.back.page &&
      !(face.page.number === plan.back.page.number && face.page.url === plan.back.page.url)) continue
    if (face.crop !== plan.back.crop) return face
  }

  // The target wide source contributes exactly two virtual faces. In unusual
  // topology arrangements baseFaces may not preserve object identity, so fall
  // back to whichever target face is not the curl's back face.
  return plan.targetFaces.find(face => face.crop !== plan.back.crop) || null
}

function targetFaceStyle(sheet: any, face: PhysicalPageFace): Record<string, string> {
  const {top, width, height} = sheet.pageBounds
  const spine = rootWidth(sheet) / 2
  const side = faceSide(face)
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

function alignedBackContentStyle(sheet: any): Record<string, string> {
  if (!sheet.pageBoundsReady || !sheet.pageBounds) return {opacity: '0'}
  const {left, top, width, height} = sheet.pageBounds
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return {opacity: '0'}
  }

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

/**
 * Final isolated renderer for forward single-page -> double-width navigation.
 * It deliberately does not reuse the lower compositor's VNode tree: that tree
 * has historical position/opacity mutations for several earlier approaches.
 * We reuse only its stable pageBounds/touch geometry, then paint one deterministic
 * state for each phase.
 */
export function installSinglePageWideTransition(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || paperOptions.__singlePageWideTransitionInstalled) return
  paperOptions.__singlePageWideTransitionInstalled = true

  const originalDuration = readerOptions.computed?.transitionDuration
  if (typeof originalDuration === 'function') {
    readerOptions.computed.transitionDuration = function (this: any): number {
      const plan = intoWidePlan(this)
      if (plan) return plan.crossesSyntheticBlank ? 430 : 370
      return originalDuration.call(this)
    }
  }

  const originalMeasureAxisSize = readerOptions.methods?.measureAxisSize
  if (typeof originalMeasureAxisSize === 'function') {
    readerOptions.methods.measureAxisSize = function (this: any, root: HTMLElement): number {
      const fallback = originalMeasureAxisSize.call(this, root)
      if (!intoWidePlan(this)) return fallback
      const width = stableCurrentWidth(this)
      const viewport = Math.max(1, root.clientWidth || window.innerWidth)
      return width === null ? fallback : Math.max(1, Math.min(viewport, width))
    }
  }

  const originalFollowFingerMove = readerOptions.methods?.followFingerMove
  if (typeof originalFollowFingerMove === 'function') {
    readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
      originalFollowFingerMove.call(this, event)
      if (!(this.$el instanceof HTMLElement) || !intoWidePlan(this)) return

      const width = stableCurrentWidth(this)
      if (width === null) return
      const viewport = Math.max(1, this.$el.clientWidth || window.innerWidth)
      const span = Math.max(1, Math.min(viewport, width))
      this.drag.axisSize = span
      this.drag.offset = Math.max(-span, Math.min(span, this.drag.rawOffset))
    }
  }

  const originalMeasurePageBounds = paperOptions.methods?.measurePageBounds
  if (typeof originalMeasurePageBounds === 'function') {
    paperOptions.methods.measurePageBounds = function (this: any): void {
      originalMeasurePageBounds.call(this)
      if (!sheetPlan(this) || !this.pageBoundsReady || !this.pageBounds) return

      // The source portrait and the synthetic blank both remain centered at the
      // beginning of their curl. The lower compositor used to snap a blank front
      // to the spine during measurement, which caused the hand-off teleport.
      const width = Math.max(1, this.pageBounds.width)
      this.pageBounds = {
        ...this.pageBounds,
        left: (rootWidth(this) - width) / 2,
      }
      this.heightOverWidth = this.pageBounds.height / width
      if (typeof this.syncTouchGeometry === 'function') this.syncTouchGeometry()
    }
  }

  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      const plan = sheetPlan(this)
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
    // Let all lower wrappers run so image-load/touch bookkeeping remains intact,
    // but do not reuse their visual tree for this transition.
    const fallback = originalRender.call(this, h) as VNode
    const plan = sheetPlan(this)
    if (!plan || !this.pageBoundsReady || !this.pageBounds) return fallback

    const reader = this.$parent as any
    const currentSpread = reader.spreads?.[reader.drag.currentIndex] as PageDtoWithUrl[] | undefined
    const targetSpread = reader.spreads?.[reader.drag.targetIndex] as PageDtoWithUrl[] | undefined
    if (!currentSpread || !targetSpread) return fallback

    const progress = clamp01(this.progress)
    const curl = localCurlProgress(plan, progress)
    const settle = smooth((progress - CURL_END) / (1 - CURL_END))
    const physicalOpacity = 1 - settle
    const direction = Math.sign(this.physicalDirection || -1)
    const {width} = this.pageBounds
    // Once the slide phase places a synthetic blank in the center, the curl must
    // start and remain there. Never move the whole turning group toward a virtual
    // spine while the fold develops.
    const turnShift = 0
    const stationary = stationaryTargetFace(plan)

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    const rootChildren: VNode[] = []

    // Keep an immutable portrait image in .paper-current for every phase. Native
    // descendant image loads can trigger page-bound measurement at any time; the
    // synthetic blank has no image, so without this node pageBoundsReady could
    // oscillate false/true and visibly swap renderers during follow-finger.
    rootChildren.push(h('div', {
      staticClass: 'paper-layer paper-current single-page-wide-measure',
      style: {
        visibility: 'hidden',
        zIndex: '0',
        pointerEvents: 'none',
      },
    }, [spread(currentSpread)]))

    if (plan.crossesSyntheticBlank && progress < BLANK_SLIDE_END) {
      const slide = smooth(progress / BLANK_SLIDE_END)
      const sourceFade = 1 - smooth((slide - 0.84) / 0.16)

      rootChildren.push(h('div', {
        staticClass: 'paper-layer single-page-wide-source-slide',
        style: {
          zIndex: '12',
          opacity: `${sourceFade}`,
          transform: `translate3d(${direction * width * slide}px, 0, 0)`,
          pointerEvents: 'none',
        },
      }, [spread(currentSpread)]))

      rootChildren.push(h('div', {
        staticClass: 'paper-layer single-page-wide-blank-slide',
        style: {
          zIndex: '13',
          transform: `translate3d(${-direction * width * (1 - slide)}px, 0, 0)`,
          pointerEvents: 'none',
        },
      }, [h('div', {
        style: {
          ...sourceRect(this),
          background: '#fff',
        },
      })]))

      return h('div', {
        staticClass: 'paper-sheet single-page-wide-isolated single-page-wide-slide-phase',
        attrs: {'aria-hidden': 'true'},
        style: {overflow: 'visible'},
      }, rootChildren)
    }

    // Physical curl phase. At curl=0 this is visually identical to the preceding
    // slide's final frame for the staged case. In the aligned case the sheet
    // stays at the exact idle single-page position throughout the curl.
    if (stationary) {
      rootChildren.push(renderFace(
        h,
        stationary,
        {
          ...targetFaceStyle(this, stationary),
          opacity: `${physicalOpacity * smooth(curl / 0.55)}`,
        },
        'single-page-wide-stationary-target',
      ))
    }

    const front = plan.crossesSyntheticBlank
      ? ({page: {number: 0, url: ''} as PageDtoWithUrl, crop: 'full'} as PhysicalPageFace)
      : plan.front

    rootChildren.push(h('div', {
      staticClass: 'single-page-wide-turning-group',
      style: {
        position: 'absolute',
        inset: '0',
        zIndex: '8',
        opacity: `${physicalOpacity}`,
        transform: `translate3d(${turnShift}px, 0, 0)`,
        willChange: 'opacity',
      },
    }, [
      h('div', {
        staticClass: 'paper-layer paper-current single-page-wide-current',
        style: this.currentStyle,
      }, [renderFace(h, front, sourceRect(this), 'single-page-wide-front-face')]),
      h('div', {
        staticClass: 'paper-layer paper-back physical-comic-paper-back single-page-wide-back',
        style: this.backStyle,
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: alignedBackContentStyle(this),
        }, [renderFace(h, plan.back, sourceRect(this), 'single-page-wide-back-face')]),
      ]),
      h('div', {staticClass: 'paper-shadow', style: this.shadowStyle}),
      h('div', {staticClass: 'paper-edge', style: this.edgeStyle}),
    ]))

    if (settle > 0) {
      rootChildren.push(h('div', {
        staticClass: 'paper-layer single-page-wide-final-target',
        style: {
          zIndex: '14',
          opacity: `${settle}`,
          pointerEvents: 'none',
        },
      }, [spread(targetSpread)]))
    }

    return h('div', {
      staticClass: 'paper-sheet single-page-wide-isolated single-page-wide-curl-phase',
      attrs: {'aria-hidden': 'true'},
      style: {overflow: 'visible'},
    }, rootChildren)
  }
}
