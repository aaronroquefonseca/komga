import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderTransition} from '@/types/enum-reader'
import {physicalComicTransitionKind} from '@/functions/paged-reader-physical'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

type HorizontalRect = {
  left: number
  right: number
  width: number
}

/**
 * PagedReaderSpread uses object-fit: contain. getBoundingClientRect() therefore
 * reports the CSS image box, which can still be the full viewport even when the
 * painted comic page is much narrower. Recover the horizontal painted bounds so
 * physical transitions can use the sheet rather than the viewport as reference.
 */
function paintedImageHorizontalRect(image: HTMLImageElement): HorizontalRect | null {
  const rect = image.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (naturalWidth <= 0 || naturalHeight <= 0) return null

  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const width = naturalWidth * scale
  const left = rect.left + (rect.width - width) / 2

  return {
    left,
    right: left + width,
    width,
  }
}

function spreadPaintedWidth(reader: any, spreadIndex: number): number | null {
  if (!(reader.$el instanceof HTMLElement)) return null

  const spreadElements = reader.$el.querySelectorAll('.transition-spread')
  const spreadElement = spreadElements.item(spreadIndex)
  if (!(spreadElement instanceof HTMLElement)) return null

  // During a double-page curl the current spread contains the stationary A|D
  // base plus the front/back leaf artwork. Measure the base only so transforms
  // on the curling sheet cannot change the gesture span as the finger moves.
  const baseImages = spreadElement.querySelectorAll('.double-page-curl-base img')
  const images = baseImages.length > 0 ? baseImages : spreadElement.querySelectorAll('img')
  const rects = Array.from(images)
    .map(image => paintedImageHorizontalRect(image as HTMLImageElement))
    .filter((rect): rect is HorizontalRect => rect !== null)

  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  return Math.max(1, right - left)
}

function isPhysicalSlide(reader: any): boolean {
  if (reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null) return false

  return physicalComicTransitionKind(
    reader.pageLayout,
    reader.spreads[reader.drag.currentIndex],
    reader.spreads[reader.drag.targetIndex],
    reader.vertical,
  ) === 'slide'
}

function isPhysicalDoubleCurl(reader: any): boolean {
  if (reader.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
    reader.vertical ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null ||
    reader.doublePageLeafTransition !== true) return false

  return physicalComicTransitionKind(
    reader.pageLayout,
    reader.spreads[reader.drag.currentIndex],
    reader.spreads[reader.drag.targetIndex],
    reader.vertical,
  ) === 'curl'
}

/**
 * Physical transitions should advance by the width of the thing that is
 * physically moving, not blindly by the browser viewport.
 *
 * - A single-page slide moves between two adjacent painted pages, so its
 *   center-to-center distance is half the sum of their widths.
 * - A double-page curl moves the grabbed outer edge across the complete open
 *   book. The curl geometry then reflects that one leaf-width past the center
 *   spine and exactly onto the opposite page.
 */
function physicalGestureSpan(reader: any, viewportSpan: number): number | null {
  if (isPhysicalSlide(reader)) {
    const currentWidth = spreadPaintedWidth(reader, reader.drag.currentIndex)
    const targetWidth = spreadPaintedWidth(reader, reader.drag.targetIndex)
    const paintedSpan = currentWidth !== null && targetWidth !== null
      ? (currentWidth + targetWidth) / 2
      : currentWidth ?? targetWidth

    if (paintedSpan === null) return null
    return Math.max(1, Math.min(viewportSpan, paintedSpan))
  }

  if (isPhysicalDoubleCurl(reader)) {
    const openBookWidth = spreadPaintedWidth(reader, reader.drag.currentIndex)
    if (openBookWidth === null) return null
    return Math.max(1, Math.min(viewportSpan, openBookWidth))
  }

  return null
}

function applyPaperBoundsClip(vnode: VNode, paperSheet: any): void {
  if (!vnode.data || !paperSheet.pageBoundsReady || !paperSheet.pageBounds) return

  const {left, top, width, height} = paperSheet.pageBounds
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return

  const right = left + width
  const bottom = top + height
  const clip = `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)`

  vnode.data.style = {
    ...(vnode.data.style as Record<string, string> || {}),
    clipPath: clip,
    WebkitClipPath: clip,
  }
}

/**
 * Keep Physical Comic transitions bound to the actual painted comic sheet.
 *
 * - Single-page curl layers are clipped as a complete compositor to the measured
 *   page rectangle, preventing reflected flap edges, shadows, and crease
 *   decoration from leaking into letterboxed side margins.
 * - Single-page Physical Comic slides use the painted page span instead of the
 *   viewport width, keeping the outgoing and incoming page edges together.
 * - Double-page Physical Comic curls use the painted open-book width, allowing
 *   one leaf to extend exactly one page through the center spine.
 * - During single-page slides only the current and target pages are rendered.
 *   Earlier and later pages stay hidden so no extra sheets become visible.
 * - The physical under-page remains stationary during a live single-page curl
 *   and only begins its helper slide during post-release settlement.
 */
export function installPhysicalPagedReaderSettlementGuard(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!paperOptions || paperOptions.__physicalSettlementGuardInstalled) return
  paperOptions.__physicalSettlementGuardInstalled = true

  if (readerOptions?.methods) {
    const originalMeasureAxisSize = readerOptions.methods.measureAxisSize
    if (typeof originalMeasureAxisSize === 'function') {
      readerOptions.methods.measureAxisSize = function (this: any, root: HTMLElement): number {
        const viewportSpan = originalMeasureAxisSize.call(this, root)
        return physicalGestureSpan(this, viewportSpan) ?? viewportSpan
      }

      const originalFollowFingerMove = readerOptions.methods.followFingerMove
      if (typeof originalFollowFingerMove === 'function') {
        readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
          originalFollowFingerMove.call(this, event)

          if (this.transition !== PagedReaderTransition.PHYSICAL_COMIC ||
            !this.drag?.prepared ||
            this.drag.targetIndex === null ||
            !(this.$el instanceof HTMLElement)) return

          // followFingerStart cannot know the target direction yet, so it starts
          // with the viewport span. Once the first horizontal movement resolves
          // the adjacent page, switch to the physical transition span and
          // recompute the offset from the raw finger position in the same frame.
          const viewportSpan = originalMeasureAxisSize.call(this, this.$el)
          const span = physicalGestureSpan(this, viewportSpan)
          if (span === null) return

          this.drag.axisSize = span
          this.drag.offset = Math.max(-span, Math.min(span, this.drag.rawOffset))
        }
      }
    }

    const originalShouldRenderCustomSpread = readerOptions.methods.shouldRenderCustomSpread
    if (typeof originalShouldRenderCustomSpread === 'function') {
      readerOptions.methods.shouldRenderCustomSpread = function (this: any, spreadIndex: number): boolean {
        if (isPhysicalSlide(this)) {
          return spreadIndex === this.drag.currentIndex || spreadIndex === this.drag.targetIndex
        }
        return originalShouldRenderCustomSpread.call(this, spreadIndex)
      }
    }

    const originalCustomSpreadStyle = readerOptions.methods.customSpreadStyle
    if (typeof originalCustomSpreadStyle === 'function') {
      readerOptions.methods.customSpreadStyle = function (this: any, spreadIndex: number): Record<string, string> {
        const style = originalCustomSpreadStyle.call(this, spreadIndex)
        if (!isPhysicalSlide(this) ||
          spreadIndex === this.drag.currentIndex ||
          spreadIndex === this.drag.targetIndex) return style

        return {
          ...style,
          opacity: '0',
          zIndex: '0',
          pointerEvents: 'none',
          filter: 'none',
        }
      }
    }
  }

  const originalRender = paperOptions.render
  paperOptions.render = function (this: any, h: CreateElement): VNode {
    const vnode = originalRender.call(this, h) as VNode
    const parent = this.$parent as any

    // Double-page Physical Comic has its own open-book clip: its curled back face
    // must be allowed to cross the center spine and occupy the opposite page.
    // Other single-page curls remain strictly clipped to their painted page.
    if (!parent?.doublePageLeafTransition) applyPaperBoundsClip(vnode, this)

    const physicalSingleCurl = parent &&
      parent.transition === PagedReaderTransition.PHYSICAL_COMIC &&
      typeof parent.effectiveTransition === 'function' &&
      parent.effectiveTransition() === PagedReaderTransition.PAPER_CURL &&
      !parent.doublePageLeafTransition &&
      parent.physicalComicUnderSpread

    if (!physicalSingleCurl) return vnode

    const children = (vnode.children || []) as VNode[]
    const target = children.find(child => {
      const staticClass = child?.data?.staticClass || ''
      return staticClass.split(/\s+/).includes('paper-target')
    })
    if (!target?.data) return vnode

    const axisSize = Math.max(1, parent?.drag?.axisSize || window.innerWidth)
    const direction = Math.sign(this.physicalDirection || -1)

    let slideProgress = 0
    if (parent.drag?.settling && parent.drag?.settleCommit) {
      const releaseProgress = clamp01(Math.abs(parent.drag.rawOffset || 0) / axisSize)
      const currentProgress = clamp01(this.progress)
      const remaining = 1 - releaseProgress

      // If the finger was released before the exact endpoint, use the remaining
      // curl distance as the slide's local 0..1 timeline. At exactly 100% there
      // is no remaining curl motion to synchronize with, so leave the under-page
      // pinned rather than flashing a completed slide for one frame.
      if (remaining > 0.001) {
        const local = clamp01((currentProgress - releaseProgress) / remaining)
        slideProgress = 1 - Math.pow(1 - local, 3)
      }
    }

    target.data.style = {
      ...(target.data.style as Record<string, string> || {}),
      transform: `translate3d(${direction * axisSize * slideProgress}px, 0, 0)`,
      willChange: 'transform',
      filter: slideProgress > 0
        ? `drop-shadow(${-direction * 10}px 0 12px rgba(0, 0, 0, ${0.12 + slideProgress * 0.12}))`
        : 'none',
    }

    return vnode
  }
}
