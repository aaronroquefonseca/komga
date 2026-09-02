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
        !this.drag?.active ||
        previousDelta === 0 ||
        previousTarget === null ||
        this.drag.navigationDelta === previousDelta ||
        Math.abs(Number(this.drag.rawOffset) || 0) > directionHandoffDistance(this)) return

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
