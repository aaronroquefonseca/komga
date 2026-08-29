import {PagedReaderLayout} from '@/types/enum-reader'
import {PageDtoWithUrl} from '@/types/komga-books'

export type PhysicalComicTransitionKind = 'curl' | 'slide'

function firstRealPageNumber(spread: PageDtoWithUrl[] | undefined): number | null {
  if (!spread) return null
  const page = spread.find(x => x.number > 0)
  return page?.number ?? null
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
 * navigation direction. Returning null lets the compositor fall back cleanly at
 * book boundaries.
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
