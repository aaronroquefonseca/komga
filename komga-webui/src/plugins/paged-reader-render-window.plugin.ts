import PagedReader from '@/components/readers/PagedReader.vue'
import {PagedReaderLayout, PagedReaderTransition} from '@/types/enum-reader'
import {
  PhysicalSinglePageEdgePlan,
  physicalSinglePageEdgePlan,
} from '@/functions/paged-reader-physical'

const WINDOW_RADIUS = 3

type HorizontalRect = {
  left: number
  right: number
  width: number
}

function activeSpreadIndices(reader: any): number[] {
  const count = reader.spreads?.length || 0
  if (count <= 0) return []

  const indices = new Set<number>()
  const addWindow = (centre: number) => {
    if (!Number.isInteger(centre)) return
    const start = Math.max(0, centre - WINDOW_RADIUS)
    const end = Math.min(count - 1, centre + WINDOW_RADIUS)
    for (let index = start; index <= end; index++) indices.add(index)
  }

  addWindow(reader.visualPage)
  if (reader.drag?.prepared) addWindow(reader.drag.currentIndex)
  if (reader.drag?.targetIndex !== null && reader.drag?.targetIndex !== undefined) {
    indices.add(reader.drag.targetIndex)
  }

  return Array.from(indices).sort((a, b) => a - b)
}

function singlePhysicalPlan(reader: any): PhysicalSinglePageEdgePlan | null {
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

function paintedWidth(element: Element | null): number | null {
  if (!(element instanceof HTMLElement)) return null
  const rects = Array.from(element.querySelectorAll('img'))
    .map(image => paintedImageHorizontalRect(image as HTMLImageElement))
    .filter((rect): rect is HorizontalRect => rect !== null)
  if (rects.length === 0) return null

  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  return Math.max(1, right - left)
}

function currentSpreadElement(reader: any): HTMLElement | null {
  if (!(reader.$el instanceof HTMLElement)) return null
  return reader.$el.querySelector('.transition-spread.transition-current') as HTMLElement | null
}

function targetSpreadElement(reader: any): HTMLElement | null {
  if (!(reader.$el instanceof HTMLElement)) return null
  return reader.$el.querySelector('.transition-spread.transition-target') as HTMLElement | null
}

function movingLeafWidth(reader: any, plan: PhysicalSinglePageEdgePlan): number | null {
  const current = currentSpreadElement(reader)
  if (!current) return null

  const liveImage = current.querySelector('.single-page-physical-front-face img') as HTMLImageElement | null
  if (liveImage) {
    const rect = paintedImageHorizontalRect(liveImage)
    if (rect) return plan.currentWide ? rect.width / 2 : rect.width
  }

  const width = paintedWidth(current)
  if (width === null) return null
  return plan.currentWide ? width / 2 : width
}

function physicalSpan(reader: any, viewportSpan: number): number | null {
  const plan = singlePhysicalPlan(reader)
  if (!plan) return null

  // The inside-cover synthetic gap has its own staged compositor and measures
  // the untouched current page directly from the layout anchor. Do not replace
  // that stable gesture span with a union of the staged DOM layers here.
  if (plan.crossesSyntheticBlank && !plan.currentWide && !plan.targetWide) return null

  if (plan.kind === 'slide') {
    const currentWidth = paintedWidth(currentSpreadElement(reader))
    const targetWidth = paintedWidth(targetSpreadElement(reader))
    const span = currentWidth !== null && targetWidth !== null
      ? (currentWidth + targetWidth) / 2
      : currentWidth ?? targetWidth
    return span === null ? null : Math.max(1, Math.min(viewportSpan, span))
  }

  const compositeCurl = plan.currentWide || plan.targetWide || plan.crossesSyntheticBlank
  if (!compositeCurl) return null

  const width = movingLeafWidth(reader, plan)
  return width === null ? null : Math.max(1, Math.min(viewportSpan, width))
}

/**
 * Keep the custom reader's reactive render cost independent of book length.
 *
 * The template historically iterates every spread and leaves most entries as
 * empty absolute-positioned wrappers. That is cheap for short books but causes
 * every drag frame to rebuild hundreds of VNodes for long comics. Intercept only
 * the PagedReader render-list invocation over reader.spreads and feed it the same
 * neighbourhood that shouldRenderCustomSpread() can actually render.
 *
 * reader.spreads itself remains the complete source array, so navigation,
 * topology and page numbering continue to use original indices.
 */
export function installReaderRenderWindow(): void {
  const readerOptions = (PagedReader as any).options
  if (!readerOptions || readerOptions.__readerRenderWindowInstalled) return
  readerOptions.__readerRenderWindowInstalled = true

  const originalRender = readerOptions.render
  if (typeof originalRender === 'function') {
    readerOptions.render = function (this: any): any {
      const originalRenderList = this._l
      if (typeof originalRenderList !== 'function' || !this.customRendererEnabled) {
        return originalRender.call(this)
      }

      const reader = this
      this._l = function (value: any, render: (...args: any[]) => any): any {
        if (value !== reader.spreads) {
          return originalRenderList.call(this, value, render)
        }

        const rendered = activeSpreadIndices(reader)
          .map(index => render(reader.spreads[index], index))
        ;(rendered as any)._isVList = true
        return rendered
      }

      try {
        return originalRender.call(this)
      } finally {
        this._l = originalRenderList
      }
    }
  }

  // The older Physical Comic span helper addressed transition wrappers by DOM
  // ordinal. Once the DOM is windowed that ordinal is no longer the source spread
  // index, so finish the same calculation from semantic current/target classes.
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
      if (!(this.$el instanceof HTMLElement) || !singlePhysicalPlan(this)) return

      const viewportSpan = Math.max(1, this.$el.clientWidth || window.innerWidth)
      const span = physicalSpan(this, viewportSpan)
      if (span === null) return
      this.drag.axisSize = span
      this.drag.offset = Math.max(-span, Math.min(span, this.drag.rawOffset))
    }
  }
}
