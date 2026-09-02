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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
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

function compositeCurlPlan(reader: any): PhysicalSinglePageEdgePlan | null {
  const plan = singlePlan(reader)
  if (!plan || plan.kind !== 'curl') return null
  if (!plan.currentWide && !plan.targetWide && !plan.crossesSyntheticBlank) return null
  return plan
}

function isSinglePhysicalSlide(reader: any): boolean {
  return singlePlan(reader)?.kind === 'slide'
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

function spreadPaintedWidth(reader: any, spreadIndex: number): number | null {
  if (!(reader.$el instanceof HTMLElement)) return null
  const spreadElement = reader.$el.querySelectorAll('.transition-spread').item(spreadIndex)
  if (!(spreadElement instanceof HTMLElement)) return null

  const images = spreadElement.querySelectorAll('img')
  const rects = Array.from(images)
    .map(image => paintedImageHorizontalRect(image as HTMLImageElement))
    .filter((rect): rect is HorizontalRect => rect !== null)
  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  return Math.max(1, right - left)
}

function movingLeafWidth(reader: any, plan: PhysicalSinglePageEdgePlan): number | null {
  if (!(reader.$el instanceof HTMLElement)) return null
  const spreadElement = reader.$el.querySelectorAll('.transition-spread').item(reader.drag.currentIndex)
  if (!(spreadElement instanceof HTMLElement)) return null

  const liveImage = spreadElement.querySelector('.single-page-physical-front-face img') as HTMLImageElement | null
  if (liveImage) {
    const rect = paintedImageHorizontalRect(liveImage)
    if (rect) return plan.currentWide ? rect.width / 2 : rect.width
  }

  const width = spreadPaintedWidth(reader, reader.drag.currentIndex)
  if (width === null) return null
  return plan.currentWide ? width / 2 : width
}

function physicalSpan(reader: any, viewportSpan: number): number | null {
  const plan = singlePlan(reader)
  if (!plan) return null

  if (plan.kind === 'slide') {
    const currentWidth = spreadPaintedWidth(reader, reader.drag.currentIndex)
    const targetWidth = spreadPaintedWidth(reader, reader.drag.targetIndex)
    const span = currentWidth !== null && targetWidth !== null
      ? (currentWidth + targetWidth) / 2
      : currentWidth ?? targetWidth
    return span === null ? null : Math.max(1, Math.min(viewportSpan, span))
  }

  if (compositeCurlPlan(reader)) {
    const width = movingLeafWidth(reader, plan)
    return width === null ? null : Math.max(1, Math.min(viewportSpan, width))
  }

  return null
}

function samePage(face: PhysicalPageFace | null, page: PageDtoWithUrl | undefined): boolean {
  if (!face || !page) return false
  return face.page === page ||
    (face.page.number === page.number && face.page.url === page.url)
}

function isBlank(face: PhysicalPageFace): boolean {
  return face.page.number <= 0 || !face.page.url
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
  const faceStyle = {
    ...style,
    background: '#fff',
  }

  return h('div', {staticClass, style: faceStyle}, isBlank(face) ? [] : [
    h('img', {
      attrs: {
        src: face.page.url,
        alt: `Page ${face.page.number}`,
      },
      style: faceImageStyle(face),
    }),
  ])
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

function rootWidth(sheet: any): number {
  if (sheet.$el instanceof HTMLElement) {
    const width = sheet.$el.getBoundingClientRect().width
    if (width > 0) return width
  }
  return Math.max(1, window.innerWidth)
}

function slotStyle(
  sheet: any,
  side: 'left' | 'right',
  opacity = 1,
  leftOverride?: number,
): Record<string, string> {
  const {top, width, height} = sheet.pageBounds
  const spine = rootWidth(sheet) / 2
  const left = leftOverride !== undefined
    ? leftOverride
    : side === 'left' ? spine - width : spine
  return {
    position: 'absolute',
    display: 'block',
    overflow: 'hidden',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    opacity: `${clamp01(opacity)}`,
  }
}

function sourceStyle(sheet: any): Record<string, string> {
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
 * Final single-page Physical Comic layer. Installed after the existing physical,
 * double-page and settlement wrappers so it can correct source-file parity and
 * only take over the special wide/synthetic-blank curl cases.
 */
export function installSinglePagePhysicalComic(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || readerOptions.__singlePagePhysicalComicInstalled) return
  readerOptions.__singlePagePhysicalComicInstalled = true

  const originalEffectiveTransition = readerOptions.methods?.effectiveTransition
  if (typeof originalEffectiveTransition === 'function') {
    readerOptions.methods.effectiveTransition = function (this: any): PagedReaderTransition {
      if (this.transition === PagedReaderTransition.PHYSICAL_COMIC &&
        this.pageLayout === PagedReaderLayout.SINGLE_PAGE &&
        !this.vertical &&
        this.drag?.prepared &&
        this.drag.targetIndex !== null) {
        const plan = singlePlan(this)
        if (plan) return plan.kind === 'curl'
          ? PagedReaderTransition.PAPER_CURL
          : PagedReaderTransition.DEFAULT
      }
      return originalEffectiveTransition.call(this)
    }
  }

  const originalMeasureAxisSize = readerOptions.methods?.measureAxisSize
  if (typeof originalMeasureAxisSize === 'function') {
    readerOptions.methods.measureAxisSize = function (this: any, root: HTMLElement): number {
      const fallback = originalMeasureAxisSize.call(this, root)
      const viewportSpan = Math.max(1, root.clientWidth || window.innerWidth)
      return physicalSpan(this, viewportSpan) ?? fallback
    }
  }

  const originalFollowFingerMove = readerOptions.methods?.followFingerMove
  if (typeof originalFollowFingerMove === 'function') {
    readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
      originalFollowFingerMove.call(this, event)
      if (!(this.$el instanceof HTMLElement) || !singlePlan(this)) return

      const viewportSpan = Math.max(1, this.$el.clientWidth || window.innerWidth)
      const span = physicalSpan(this, viewportSpan)
      if (span === null) return
      this.drag.axisSize = span
      this.drag.offset = Math.max(-span, Math.min(span, this.drag.rawOffset))
    }
  }

  const originalShouldRenderCustomSpread = readerOptions.methods?.shouldRenderCustomSpread
  if (typeof originalShouldRenderCustomSpread === 'function') {
    readerOptions.methods.shouldRenderCustomSpread = function (this: any, spreadIndex: number): boolean {
      const composite = compositeCurlPlan(this)
      if (composite) return spreadIndex === this.drag.currentIndex
      if (isSinglePhysicalSlide(this)) {
        return spreadIndex === this.drag.currentIndex || spreadIndex === this.drag.targetIndex
      }
      return originalShouldRenderCustomSpread.call(this, spreadIndex)
    }
  }

  const originalCustomSpreadStyle = readerOptions.methods?.customSpreadStyle
  if (typeof originalCustomSpreadStyle === 'function') {
    readerOptions.methods.customSpreadStyle = function (this: any, spreadIndex: number): Record<string, string> {
      const style = originalCustomSpreadStyle.call(this, spreadIndex)
      const composite = compositeCurlPlan(this)
      if (composite) {
        if (spreadIndex === this.drag.currentIndex) {
          return {
            transform: 'translate3d(0, 0, 0)',
            opacity: '1',
            zIndex: '4',
            pointerEvents: 'none',
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

      if (!isSinglePhysicalSlide(this) ||
        spreadIndex === this.drag.currentIndex || spreadIndex === this.drag.targetIndex) return style
      return {
        ...style,
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
      originalMeasurePageBounds.call(this)
      const parent = this.$parent as any
      const plan = compositeCurlPlan(parent)
      if (!plan || !this.pageBoundsReady || !this.pageBounds) return

      const {top, width: measuredWidth, height} = this.pageBounds
      if (![top, measuredWidth, height].every(Number.isFinite) || measuredWidth <= 0 || height <= 0) return

      let width = measuredWidth
      if (plan.currentWide) width = measuredWidth / 2

      // If the front is a synthetic blank, the bootstrap image is the current
      // portrait page and therefore already supplies exactly one leaf width.
      if (plan.currentWide || isBlank(plan.front)) {
        const side = sourceSide(plan, Math.sign(this.physicalDirection || -1) < 0)
        const spine = rootWidth(this) / 2
        this.pageBounds = {
          ...this.pageBounds,
          left: side === 'left' ? spine - width : spine,
          width,
        }
      } else {
        this.pageBounds = {...this.pageBounds, width}
      }

      this.heightOverWidth = height / Math.max(1, width)
      if (typeof this.syncTouchGeometry === 'function') this.syncTouchGeometry()
    }
  }

  const originalGeometry = paperOptions.computed?.geometry
  if (typeof originalGeometry === 'function') {
    paperOptions.computed.geometry = function (this: any) {
      const parent = this.$parent as any
      if (!compositeCurlPlan(parent)) return originalGeometry.call(this)

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
    const parent = this.$parent as any
    const plan = compositeCurlPlan(parent)
    if (!plan) return originalRender.call(this, h) as VNode

    const spread = (value: PageDtoWithUrl[]) => h('paged-reader-spread', {
      props: {
        spread: value,
        flipDirection: this.flipDirection,
        scale: this.scale,
      },
    })

    // Preserve the exact idle source while the component measures it. This is
    // particularly important when the physical front is a synthetic blank: the
    // user should never see the current artwork disappear just because geometry
    // has not been measured yet.
    if (!this.pageBoundsReady) {
      return h('div', {
        staticClass: 'paper-sheet single-page-physical-bootstrap',
        attrs: {'aria-hidden': 'true'},
      }, [
        h('div', {staticClass: 'paper-layer paper-current'}, [spread(this.frontSpread)]),
      ])
    }

    const progress = clamp01(this.progress)
    const direction = Math.sign(this.physicalDirection || -1)
    const startsRight = direction < 0
    const currentPage = parent.spreads?.[parent.drag.currentIndex]?.[0] as PageDtoWithUrl | undefined
    const targetPage = parent.spreads?.[parent.drag.targetIndex]?.[0] as PageDtoWithUrl | undefined
    const collapse = !plan.targetWide && (plan.currentWide || plan.crossesSyntheticBlank)
      ? smooth((progress - 0.78) / 0.22)
      : 0
    const expand = smooth(progress / 0.55)

    const source = sourceStyle(this)
    const desiredSide = sourceSide(plan, startsRight)
    const spine = rootWidth(this) / 2
    const desiredSourceLeft = desiredSide === 'left'
      ? spine - this.pageBounds.width
      : spine

    // A portrait source is centered while idle. When it opens into a wide
    // spread, move the complete turning-sheet compositor toward its physical
    // half-spread slot as the curl develops. A wide source or synthetic blank is
    // already spine-anchored by measurePageBounds().
    const shiftEnd = (!plan.currentWide && !isBlank(plan.front) && plan.targetWide)
      ? desiredSourceLeft - this.pageBounds.left
      : 0
    const turnShift = shiftEnd * smooth(progress)

    const logicalBase = plan.baseFaces
    const screenBase: [PhysicalPageFace | null, PhysicalPageFace | null] = this.flipDirection
      ? [logicalBase[1], logicalBase[0]]
      : [logicalBase[0], logicalBase[1]]

    const baseNodes: VNode[] = []
    ;(['left', 'right'] as const).forEach((side, index) => {
      const face = screenBase[index]
      if (!face) return
      const belongsCurrent = samePage(face, currentPage)
      const belongsTarget = samePage(face, targetPage)
      if (!belongsCurrent && !belongsTarget) return

      let opacity = 1
      if (!plan.targetWide) opacity = 1 - collapse
      else if (belongsTarget && !plan.currentWide && !plan.crossesSyntheticBlank) opacity = expand

      let leftOverride: number | undefined
      if (belongsCurrent && !plan.currentWide && plan.crossesSyntheticBlank) {
        // The single portrait was centered at rest. Expand it into the stationary
        // side of the temporary open book while the blank companion turns.
        const centered = (rootWidth(this) - this.pageBounds.width) / 2
        const finalLeft = side === 'left' ? spine - this.pageBounds.width : spine
        leftOverride = centered + (finalLeft - centered) * expand
      }

      baseNodes.push(renderFace(
        h,
        face,
        slotStyle(this, side, opacity, leftOverride),
        `single-page-physical-base-face single-page-physical-base-${side}`,
      ))
    })

    const frontOpacity = isBlank(plan.front) ? smooth(progress / 0.16) : 1
    const frontStyle = {...source, opacity: `${frontOpacity}`}

    const turnGroup = h('div', {
      staticClass: 'single-page-physical-turning-group',
      style: {
        position: 'absolute',
        inset: '0',
        transform: `translate3d(${turnShift}px, 0, 0)`,
        willChange: shiftEnd !== 0 ? 'transform' : 'auto',
      },
    }, [
      h('div', {
        staticClass: 'paper-layer paper-current single-page-physical-current',
        style: this.currentStyle,
      }, [
        renderFace(h, plan.front, frontStyle, 'single-page-physical-front-face'),
      ]),
      h('div', {
        staticClass: 'paper-layer paper-back physical-comic-paper-back single-page-physical-back',
        style: this.backStyle,
      }, [
        h('div', {
          staticClass: 'paper-back-content',
          style: alignedBackContentStyle(this),
        }, [
          renderFace(h, plan.back, source, 'single-page-physical-back-face'),
        ]),
      ]),
      h('div', {staticClass: 'paper-shadow', style: this.shadowStyle}),
      h('div', {staticClass: 'paper-edge', style: this.edgeStyle}),
    ])

    const children: VNode[] = [
      h('div', {
        staticClass: 'paper-layer single-page-physical-base',
        style: {zIndex: '1'},
      }, baseNodes),
      turnGroup,
    ]

    // Leaving an open wide state for a normal single page collapses the physical
    // spread back to the reader's centered idle geometry during the tail. The
    // actual target spread is used for this final overlay, making the commit
    // frame identical to the post-transition frame instead of snapping sideways.
    if (collapse > 0 && targetPage) {
      children.push(h('div', {
        staticClass: 'paper-layer single-page-physical-target-settlement',
        style: {
          zIndex: '8',
          opacity: `${collapse}`,
          pointerEvents: 'none',
        },
      }, [spread([targetPage])]))
    }

    return h('div', {
      staticClass: 'paper-sheet single-page-physical-composite',
      attrs: {'aria-hidden': 'true'},
      style: {overflow: 'visible'},
    }, children)
  }
}
