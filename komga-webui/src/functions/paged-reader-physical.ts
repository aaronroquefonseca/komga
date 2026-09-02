import {PagedReaderLayout} from '@/types/enum-reader'
import {PageDtoWithUrl} from '@/types/komga-books'
import {isPageLandscape} from '@/functions/page'

export type PhysicalComicTransitionKind = 'curl' | 'slide'

export type DoublePageLeafPlan = {
  front: PageDtoWithUrl
  back: PageDtoWithUrl
  baseSpread: PageDtoWithUrl[]
}

export type PhysicalPageCrop = 'full' | 'left' | 'right'

/**
 * One visible physical page face. A normal portrait page uses the complete
 * source image; a pre-combined landscape scan contributes two virtual faces
 * backed by the left and right halves of the same source image.
 */
export type PhysicalPageFace = {
  page: PageDtoWithUrl
  crop: PhysicalPageCrop
}

export type PhysicalDoublePageLeafPlan = {
  front: PhysicalPageFace
  back: PhysicalPageFace
  /** Logical reading-order faces that stay flat underneath the turning leaf. */
  baseFaces: [PhysicalPageFace, PhysicalPageFace]
}

export type PhysicalSinglePageEdgePlan = {
  kind: PhysicalComicTransitionKind
  direction: number
  currentFaces: PhysicalPageFace[]
  targetFaces: PhysicalPageFace[]
  front: PhysicalPageFace
  back: PhysicalPageFace
  /** Faces immediately outside the turning sheet: boundary-1 and boundary+2. */
  baseFaces: [PhysicalPageFace | null, PhysicalPageFace | null]
  currentWide: boolean
  targetWide: boolean
  /** 1-based physical face ordinal printed on the front of the crossed leaf. */
  boundaryFace: number
  crossesSyntheticBlank: boolean
}

function firstRealPageNumber(spread: PageDtoWithUrl[] | undefined): number | null {
  if (!spread) return null
  const page = spread.find(x => x.number > 0)
  return page?.number ?? null
}

function syntheticBlankFace(): PhysicalPageFace {
  return {
    page: {
      number: 0,
      url: '',
      width: 20,
      height: 30,
    } as PageDtoWithUrl,
    crop: 'full',
  }
}

/**
 * Normalize a rendered double-page spread into two logical physical page faces.
 *
 * Normal spreads already contain two sequential pages. A landscape scan is one
 * source image spanning both visible pages, so expose its halves as virtual
 * faces. In RTL the first logical face is the source image's right half because
 * that is the first side encountered in manga reading order; the image itself is
 * never mirrored or modified.
 */
export function physicalFacesForSpread(
  spread: PageDtoWithUrl[] | undefined,
  flipDirection: boolean,
): [PhysicalPageFace, PhysicalPageFace] | null {
  if (!spread || spread.length === 0) return null

  if (spread.length === 2) {
    return [
      {page: spread[0], crop: 'full'},
      {page: spread[1], crop: 'full'},
    ]
  }

  if (spread.length === 1 && isPageLandscape(spread[0])) {
    const left: PhysicalPageFace = {page: spread[0], crop: 'left'}
    const right: PhysicalPageFace = {page: spread[0], crop: 'right'}
    return flipDirection ? [right, left] : [left, right]
  }

  return null
}

/**
 * Physical Comic's open-book planner. Unlike the legacy half-leaf planner below,
 * this accepts both ordinary [A, B] spreads and a single landscape scan that
 * visually contains A|B.
 *
 * Forward:  A | B -> C | D turns B(front) / C(back), base A | D
 * Backward: C | D -> A | B turns C(front) / B(back), base A | D
 */
export function physicalDoublePageLeafPlan(
  currentSpread: PageDtoWithUrl[] | undefined,
  targetSpread: PageDtoWithUrl[] | undefined,
  navigationDelta: number,
  flipDirection: boolean,
): PhysicalDoublePageLeafPlan | null {
  if (navigationDelta === 0) return null

  const current = physicalFacesForSpread(currentSpread, flipDirection)
  const target = physicalFacesForSpread(targetSpread, flipDirection)
  if (!current || !target) return null

  if (navigationDelta > 0) {
    return {
      front: current[1],
      back: target[0],
      baseFaces: [current[0], target[1]],
    }
  }

  return {
    front: current[0],
    back: target[1],
    baseFaces: [target[0], current[1]],
  }
}

/**
 * Single-page Physical Comic still has one idle navigation state per source
 * image, but a landscape scan represents two consecutive physical faces. The
 * source remains intact and is only cropped while a physical transition runs.
 */
export function physicalSinglePageFacesForSpread(
  spread: PageDtoWithUrl[] | undefined,
  flipDirection: boolean,
): PhysicalPageFace[] | null {
  if (!spread || spread.length !== 1) return null
  const page = spread[0]
  if (!isPageLandscape(page)) return [{page, crop: 'full'}]

  const left: PhysicalPageFace = {page, crop: 'left'}
  const right: PhysicalPageFace = {page, crop: 'right'}
  return flipDirection ? [right, left] : [left, right]
}

/**
 * Resolve adjacent source-image navigation into the actual physical leaf edge.
 *
 * A real two-page scan must occupy an open spread. If a later landscape source
 * would begin on the wrong physical face, bracket that source with two virtual
 * white pages:
 *
 *   portrait | blank  ->  wide-left | wide-right  ->  blank | portrait
 *
 * The blank before aligns the wide scan; the matching blank after restores the
 * previous parity so the correction stays local and cannot shift the rest of the
 * book. Single-page navigation never stops on either synthetic face, but the
 * physical animation planner can still use them as real paper surfaces.
 *
 * When one of those blanks lies between adjacent source states, anchor the plan
 * on the curl boundary touching the wide source. The staged renderer then owns
 * the other half of the source-to-source movement as a slide. This is what makes
 * both sides physically symmetric:
 *
 *   portrait -> slide -> blank -> curl -> wide
 *   wide -> curl -> blank -> slide -> portrait
 */
export function physicalSinglePageEdgePlan(
  spreads: PageDtoWithUrl[][],
  currentIndex: number,
  targetIndex: number,
  flipDirection: boolean,
): PhysicalSinglePageEdgePlan | null {
  const direction = Math.sign(targetIndex - currentIndex)
  if (direction === 0 || Math.abs(targetIndex - currentIndex) !== 1) return null
  if (currentIndex < 0 || targetIndex < 0 ||
    currentIndex >= spreads.length || targetIndex >= spreads.length) return null

  type Span = {
    first: number
    last: number
    faces: PhysicalPageFace[]
  }

  const spans: Span[] = []
  const ordinalFaces = new Map<number, PhysicalPageFace>()
  let nextOrdinal = 1

  for (let index = 0; index < spreads.length; index++) {
    const faces = physicalSinglePageFacesForSpread(spreads[index], flipDirection)
    if (!faces) return null

    // The first source may itself be a landscape cover. Every later wide source
    // must begin on an even physical face. When it does not, add both the
    // alignment face before it and the parity-restoring face after it.
    const compensateWide = index > 0 && faces.length === 2 && nextOrdinal % 2 === 1
    if (compensateWide) {
      ordinalFaces.set(nextOrdinal, syntheticBlankFace())
      nextOrdinal++
    }

    const first = nextOrdinal
    faces.forEach((face, faceIndex) => ordinalFaces.set(first + faceIndex, face))
    const last = first + faces.length - 1
    spans.push({first, last, faces})
    nextOrdinal = last + 1

    if (compensateWide) {
      ordinalFaces.set(nextOrdinal, syntheticBlankFace())
      nextOrdinal++
    }
  }

  const current = spans[currentIndex]
  const target = spans[targetIndex]
  const currentWide = current.faces.length === 2
  const targetWide = target.faces.length === 2

  const gapHasSyntheticBlank = direction > 0
    ? target.first - current.last === 2
    : current.first - target.last === 2

  let boundaryFace: number
  if (gapHasSyntheticBlank && currentWide) {
    // Leaving a compensated wide source: turn the wide leaf into its trailing
    // blank first. The staged renderer then slides blank -> target portrait.
    boundaryFace = direction > 0 ? current.last : current.first - 1
  } else if (gapHasSyntheticBlank && targetWide) {
    // Entering a compensated wide source: slide source portrait -> blank first,
    // then turn that blank into the adjacent wide leaf.
    boundaryFace = direction > 0 ? target.first - 1 : target.last
  } else {
    boundaryFace = direction > 0
      ? target.first - 1
      : current.first - 1
  }

  if (boundaryFace < 1) return null

  const lower = ordinalFaces.get(boundaryFace)
  const upper = ordinalFaces.get(boundaryFace + 1)
  if (!lower || !upper) return null

  const front = direction > 0 ? lower : upper
  const back = direction > 0 ? upper : lower
  const before = ordinalFaces.get(boundaryFace - 1) || null
  const after = ordinalFaces.get(boundaryFace + 2) || null

  return {
    kind: boundaryFace % 2 === 1 ? 'curl' : 'slide',
    direction,
    currentFaces: current.faces,
    targetFaces: target.faces,
    front,
    back,
    baseFaces: [before, after],
    currentWide,
    targetWide,
    boundaryFace,
    crossesSyntheticBlank: lower.page.number === 0 || upper.page.number === 0,
  }
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
 * Single-page callers that know the whole source sequence should prefer
 * physicalSinglePageEdgePlan(), because isolated source-number parity cannot
 * account for wide scans or their required blank alignment faces.
 */
export function physicalComicTransitionKind(
  pageLayout: PagedReaderLayout,
  currentSpread: PageDtoWithUrl[] | undefined,
  targetSpread: PageDtoWithUrl[] | undefined,
  vertical: boolean,
): PhysicalComicTransitionKind {
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
