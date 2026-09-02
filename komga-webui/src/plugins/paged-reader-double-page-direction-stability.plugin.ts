import {CreateElement, VNode} from 'vue'
import PagedReader from '@/components/readers/PagedReader.vue'
import PagedReaderPaperSheet from '@/components/readers/PagedReaderPaperSheet.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'

function isDoublePageLayout(layout: PagedReaderLayout): boolean {
  return layout === PagedReaderLayout.DOUBLE_PAGES ||
    layout === PagedReaderLayout.DOUBLE_NO_COVER
}

function isDoubleSheetGesture(reader: any): boolean {
  if (!reader ||
    reader.vertical ||
    !isDoublePageLayout(reader.pageLayout) ||
    !reader.drag?.prepared ||
    reader.drag.targetIndex === null ||
    reader.drag.navigationDelta === 0) return false

  return reader.transition === PagedReaderTransition.PHYSICAL_COMIC ||
    reader.transition === PagedReaderTransition.PAPER_CURL ||
    reader.transition === PagedReaderTransition.PAGE_TURN
}

function directionHandoffDistance(reader: any): number {
  const span = Math.max(1, Number(reader.drag?.axisSize) || 1)
  return Math.min(18, Math.max(8, span * 0.0125))
}

function directionHandoffOffset(reader: any, physicalDirection: number): number {
  const span = Math.max(1, Number(reader.drag?.axisSize) || 1)
  return Math.sign(physicalDirection || -1) * Math.min(1.5, Math.max(0.75, span * 0.0015))
}

function showDirectionHandoffCover(reader: any): void {
  reader.__doublePageDirectionCover = true
  reader.__doublePageDirectionCoverGeneration =
    (Number(reader.__doublePageDirectionCoverGeneration) || 0) + 1
}

function clearDirectionHandoffCover(reader: any): void {
  reader.__doublePageDirectionCover = false
  reader.__doublePageDirectionCoverPendingHide = false
  reader.__doublePageDirectionCoverGeneration =
    (Number(reader.__doublePageDirectionCoverGeneration) || 0) + 1
}

/** Keep the flat current spread painted for one complete frame after the new
 * target and leaf side have reached the DOM. The swap then happens underneath
 * an identical opaque page instead of briefly exposing either base spread. */
function hideDirectionHandoffCoverAfterPaint(reader: any): void {
  const generation = Number(reader.__doublePageDirectionCoverGeneration) || 0
  reader.__doublePageDirectionCoverPendingHide = true
  reader.$nextTick(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (generation !== reader.__doublePageDirectionCoverGeneration) return
        reader.__doublePageDirectionCover = false
        reader.__doublePageDirectionCoverPendingHide = false
        reader.$forceUpdate()
      })
    })
  })
}

/**
 * The measured leaf width/height stay valid when a live drag crosses through the
 * gesture origin. Only the side of the center spine changes. Correct that side
 * synchronously before the lower compositor reads currentStyle/backStyle.
 *
 * Without this, physicalDirection can already point at the new side while
 * pageBounds.left still belongs to the previous side for one render, producing a
 * one-frame clip/base mismatch.
 */
function normalizeLeafSide(sheet: any): void {
  const reader = sheet.$parent as any
  if (!isDoubleSheetGesture(reader) ||
    !sheet.pageBoundsReady ||
    !sheet.pageBounds ||
    !(sheet.$el instanceof HTMLElement)) return

  const rootWidth = (sheet.$el as HTMLElement).getBoundingClientRect().width
  const width = Number(sheet.pageBounds.width)
  if (!Number.isFinite(rootWidth) || rootWidth <= 0 || !Number.isFinite(width) || width <= 0) return

  const direction = Math.sign(sheet.physicalDirection || reader.activePhysicalDirection || -1)
  const startsRight = direction < 0
  const spine = rootWidth / 2
  const desiredLeft = startsRight ? spine : spine - width

  if (Math.abs(Number(sheet.pageBounds.left) - desiredLeft) <= 0.01) return
  sheet.pageBounds = {
    ...sheet.pageBounds,
    left: desiredLeft,
  }
}

/**
 * Keep the physical-sheet compositor alive while an active double-page gesture
 * crosses through the gesture origin.
 *
 * Touch sampling can jump directly from a small negative offset to a small
 * positive one without producing offset=0. Keep the previous valid leaf inside
 * a small hysteresis zone around the origin. Keep a sub-pixel curl rather than
 * progress=0: the exactly-flat fold collapses every clip polygon onto one line,
 * which is itself an unstable compositor frame on the affected Chromium build.
 */
export function installDoublePageDirectionStability(): void {
  const readerOptions = (PagedReader as any).options
  const paperOptions = (PagedReaderPaperSheet as any).options
  if (!readerOptions || !paperOptions || readerOptions.__doublePageDirectionStabilityInstalled) return
  readerOptions.__doublePageDirectionStabilityInstalled = true

  const originalFollowFingerMove = readerOptions.methods?.followFingerMove
  if (typeof originalFollowFingerMove === 'function') {
    readerOptions.methods.followFingerMove = function (this: any, event: TouchEvent): void {
      const preserve = !!(
        this.drag?.tracking &&
        this.drag?.active &&
        !this.vertical &&
        isDoublePageLayout(this.pageLayout)
      )
      const previousDelta = this.drag?.navigationDelta || 0
      const previousTarget = this.drag?.targetIndex ?? null
      const previousPhysicalDirection = this.drag?.physicalDirection || 0

      originalFollowFingerMove.call(this, event)

      if (!preserve ||
        !this.drag?.tracking ||
        !this.drag?.active) {
        clearDirectionHandoffCover(this)
        return
      }

      if (previousDelta === 0 || previousTarget === null) {
        clearDirectionHandoffCover(this)
        return
      }

      if (this.drag.navigationDelta === previousDelta) {
        if (this.__doublePageDirectionCover && !this.__doublePageDirectionCoverPendingHide) {
          clearDirectionHandoffCover(this)
        }
        return
      }

      showDirectionHandoffCover(this)

      if (Math.abs(Number(this.drag.rawOffset) || 0) > directionHandoffDistance(this)) {
        // targetIndex, direction and the normalized leaf side have switched on
        // this render. Leave the stable cover up until that frame is painted.
        hideDirectionHandoffCoverAfterPaint(this)
        return
      }

      this.__doublePageDirectionCoverPendingHide = false

      this.drag.navigationDelta = previousDelta
      this.drag.targetIndex = previousTarget
      this.drag.offset = directionHandoffOffset(this, previousPhysicalDirection)
      if (previousPhysicalDirection !== 0) {
        this.drag.physicalDirection = previousPhysicalDirection
      }
    }
  }

  const originalRender = paperOptions.render
  if (typeof originalRender === 'function') {
    paperOptions.render = function (this: any, h: CreateElement): VNode {
      normalizeLeafSide(this)
      return originalRender.call(this, h) as VNode
    }
  }
}
