import {PagedReaderLayout} from '@/types/enum-reader'
import {PageDtoWithUrl} from '@/types/komga-books'

export type PhysicalComicTransitionKind = 'curl' | 'slide'

export type DoublePageLeafPlan = {
  front: PageDtoWithUrl
  back: PageDtoWithUrl
  baseSpread: PageDtoWithUrl[]
}

function firstRealPageNumber(spread: PageDtoWithUrl[] | undefined): number | null {
  if (!spread) return null
  const page = spread.find(x => x.number > 0)
  return page?.number ?? null
}

export function canUseDoublePageLeaf(
  pageLayout: PagedReaderLayout,
  currentSpread: PageDtoWithUrl[] | undefined,
  targetSpread: PageDtoWithUrl[] | undefined,
  vertical: boolean,
): boolean {
  if (vertical) return false
  if (pageLayout !== PagedReaderLayout.DOUBLE_PAGES &&
    pageLayout !== PagedReaderLayout.DOUBLE_NO_COVER) return false
  return currentSpread?.length === 2 && targetSpread?.length === 2
}

/**
 * Build the physical intermediate state for an open two-page book.
 *
 * Forward:   A | B  ->  C | D   turns B(front) / C(back), base A | D
 * Backward:  C | D  ->  A | B   turns C(front) / B(back), base A | D
 *
 * Spread rendering itself mirrors the slots for RTL, so this logical mapping is
 * direction-independent.
 */
export function doublePageLeafPlan(
  currentSpread: PageDtoWithUrl[] | undefined,
  targetSpread: PageDtoWithUrl[] | undefined,
  navigationDelta: number,
): DoublePageLeafPlan | null {
  if (!currentSpread || !targetSpread ||
    currentSpread.length !== 2 || targetSpread.length !== 2 ||
    navigationDelta === 0) return null

  if (navigationDelta > 0) {
    return {
      front: currentSpread[1],
      back: targetSpread[0],
      baseSpread: [currentSpread[0], targetSpread[1]],
    }
  }

  return {
    front: currentSpread[0],
    back: targetSpread[1],
    baseSpread: [targetSpread[0], currentSpread[1]],
  }
}

/**
 * Decide how an adjacent navigation edge behaves when the reader is pretending
 * to be a physical comic book.
 *
 * Single-page mode walks across the two faces of each physical sheet:
 *   cover(1) --curl--> 2 --slide--> 3 --curl--> 4 --slide--> 5 ...
 * The same edge classification is used in reverse, so back navigation remains
 * symmetric. Double-page layouts already represent an open book, therefore an
 * adjacent spread change always crosses a physical sheet and uses a curl.
 */
export function physicalComicTransitionKind(
  pageLayout: PagedReaderLayout,
  currentSpread: PageDtoWithUrl[] | undefined,
  targetSpread: PageDtoWithUrl[] | undefined,
  vertical: boolean,
): PhysicalComicTransitionKind {
  // The curl compositor is horizontal. Keep vertical reading usable and
  // predictable by falling back to the normal axis-aware slide.
  if (vertical) return 'slide'

  if (pageLayout === PagedReaderLayout.DOUBLE_PAGES ||
    pageLayout === PagedReaderLayout.DOUBLE_NO_COVER) {
    return 'curl'
  }

  const currentPage = firstRealPageNumber(currentSpread)
  const targetPage = firstRealPageNumber(targetSpread)
  if (currentPage === null || targetPage === null) return 'slide'
  if (Math.abs(currentPage - targetPage) !== 1) return 'slide'

  return Math.min(currentPage, targetPage) % 2 === 1 ? 'curl' : 'slide'
}

/**
 * During a physical single-page curl the requested page is the back face of the
 * sheet being turned. The flat page underneath is one more step in the same
 * navigation direction. Returning null lets the compositor expose the reader
 * background cleanly at book boundaries.
 */
export function physicalComicUnderSpreadIndex(
  targetIndex: number | null,
  navigationDelta: number,
  spreadCount: number,
): number | null {
  if (targetIndex === null || navigationDelta === 0) return null
  const index = targetIndex + navigationDelta
  return index >= 0 && index < spreadCount ? index : null
}
