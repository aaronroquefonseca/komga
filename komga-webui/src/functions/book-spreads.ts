import {PageDtoWithUrl} from '@/types/komga-books'
import {PagedReaderLayout} from '@/types/enum-reader'
import {isPageLandscape} from '@/functions/page'
import {cloneDeep} from 'lodash'


export function buildSpreads(pages: PageDtoWithUrl[], pageLayout: PagedReaderLayout): PageDtoWithUrl[][] {
  if (pages.length === 0) return []
  if (pageLayout !== PagedReaderLayout.SINGLE_PAGE) {
    const spreads = [] as PageDtoWithUrl[][]
    const pagesClone = cloneDeep(pages)
    let lastPages = undefined

    if (pageLayout === PagedReaderLayout.DOUBLE_PAGES) {
      const firstPage = pagesClone.shift() as PageDtoWithUrl
      if (isPageLandscape(firstPage))
        spreads.push([firstPage] as PageDtoWithUrl[])
      else
        // The empty side outside the front cover is not a sheet of paper. Keep
        // it transparent so the reader background remains visible.
        spreads.push([createBoundaryEmptyPage(firstPage), firstPage] as PageDtoWithUrl[])
      if (pagesClone.length > 0) {
        const lastPage = pagesClone.pop() as PageDtoWithUrl
        if(isPageLandscape(lastPage))
          lastPages = [lastPage] as PageDtoWithUrl[]
        else
          // Same rule at the back cover: outside the book is background, not a
          // synthetic white page.
          lastPages = [lastPage, createBoundaryEmptyPage(lastPage)] as PageDtoWithUrl[]
      }
    }

    // Portrait and synthetic blank faces wait here until they have a physical
    // partner. Landscape sources remain atomic because one source image already
    // represents both visible pages of an open spread.
    let pendingFace: PageDtoWithUrl | undefined

    while (pagesClone.length > 0) {
      const page = pagesClone.shift() as PageDtoWithUrl

      if (isPageLandscape(page)) {
        if (pendingFace) {
          // This landscape source would occupy the second face of an ordinary
          // pair, so it is physically misaligned. Finish the preceding spread
          // with a white blank, render the wide source, then insert a matching
          // white face after it. The second blank restores the original parity
          // so this correction cannot shift the rest of the book.
          const blankBefore = createPaperBlankPage(pendingFace)
          const blankAfter = createPaperBlankPage(pendingFace)
          spreads.push([pendingFace, blankBefore])
          spreads.push([page])
          pendingFace = blankAfter
        } else {
          // Already aligned: no synthetic faces are necessary around this wide
          // source.
          spreads.push([page])
        }
        continue
      }

      if (pendingFace) {
        spreads.push([pendingFace, page])
        pendingFace = undefined
      } else {
        pendingFace = page
      }
    }

    if (pendingFace) {
      // Preserve the existing book-boundary behavior for an unmatched final
      // physical face. If this is the blank after a compensated wide scan it is
      // still kept; only the outside-of-book partner is transparent.
      spreads.push([pendingFace, createBoundaryEmptyPage(pendingFace)])
    }

    if (lastPages) spreads.push(lastPages)
    return spreads
  } else {
    return pages.map(p => [p])
  }
}

function createBoundaryEmptyPage(page: PageDtoWithUrl): PageDtoWithUrl {
  return createEmptyPage(page, false)
}

function createPaperBlankPage(page: PageDtoWithUrl): PageDtoWithUrl {
  return createEmptyPage(page, true)
}

function createEmptyPage(page: PageDtoWithUrl, white: boolean): PageDtoWithUrl {
  return {
    url: createPageDataUrl(page?.width || 20, page?.height || 30, white),
    number: 0,
  } as PageDtoWithUrl
}

function createPageDataUrl(w: number, h: number, white: boolean): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = white ? 'rgb(255,255,255)' : 'rgba(0,0,0,0)'
    ctx.fillRect(0, 0, w, h)
  }

  return canvas.toDataURL()
}
