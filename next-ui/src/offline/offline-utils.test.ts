import { describe, expect, test } from 'vitest'
import type { PageDto } from '@/generated/openapi'
import type { OfflineDownloadRecord } from './offline-types'
import {
  conditionMatches,
  conditionUsesOnlyLibrarySelection,
  dateToken,
  errorMessage,
  fullTextMatches,
  libraryIdsFromCondition,
  manifestRevision,
  operatorMatches,
  pageFromItems,
  rehydrateDates,
  remapPage,
  selectNextQueuedDownload,
  stableHash,
  stringifyFilterValue,
  summarizeDownloadGroup,
  uniqueStrings,
} from './offline-utils'

function page(number: number, fileName = `p${number}.jpg`, sizeBytes = 1000): PageDto {
  return {
    number,
    fileName,
    mediaType: 'image/jpeg',
    width: 800,
    height: 1200,
    size: '1 KB',
    sizeBytes,
  }
}

describe('stableHash', () => {
  test('matches the FNV-1a empty vector and is deterministic', () => {
    expect(stableHash('')).toBe('811c9dc5')
    expect(stableHash('komga')).toBe(stableHash('komga'))
  })

  test('distinguishes different inputs with 8 hex chars', () => {
    const hash = stableHash('komga-offline')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
    expect(stableHash('komga-offline-2')).not.toBe(hash)
  })
})

describe('manifestRevision', () => {
  test('is stable for identical manifests and changes with content', () => {
    const pages = [page(1), page(2), page(3)]
    const revision = manifestRevision(pages)
    expect(revision).toMatch(/^3-[0-9a-f]{8}$/)
    expect(manifestRevision([page(1), page(2), page(3)])).toBe(revision)
    expect(manifestRevision([page(1), page(2)])).not.toBe(revision)
    expect(manifestRevision([page(1), page(2, 'other.jpg')])).not.toBe(revision)
  })

  test('ignores container-only differences such as byte size of the archive', () => {
    // sizeBytes is part of the identity on purpose: only archive/container
    // metadata outside pages/ is excluded.
    expect(manifestRevision([page(1, 'a.jpg')])).toBe(manifestRevision([page(1, 'a.jpg')]))
  })
})

describe('remapPage', () => {
  test('returns 1 when the new manifest is empty', () => {
    expect(remapPage([page(1), page(2)], [], 2)).toBe(1)
  })

  test('finds the exact page by identity after insertions', () => {
    const oldPages = [page(1), page(2), page(3)]
    const newPages = [page(1, 'cover.jpg', 500), page(2), page(3), page(4)]
    expect(remapPage(oldPages, newPages, 2)).toBe(2)
  })

  test('falls back to content identity when the file was renamed', () => {
    const oldPages = [page(1), page(2), page(3)]
    const renamed = [
      page(1),
      {
        ...page(2),
        fileName: 'scan2.png',
        mediaType: 'image/png',
        width: 100,
        height: 100,
        sizeBytes: 5,
      },
      page(3),
    ]
    expect(remapPage(oldPages, renamed, 2)).toBe(2)
  })

  test('falls back to proportional position when nothing matches', () => {
    const oldPages = [page(1), page(2), page(3), page(4), page(5)]
    const allDifferent = [1, 2, 3].map((n) => ({
      number: n,
      fileName: `new-${n}.avif`,
      mediaType: 'image/avif',
      width: 10,
      height: 10,
      size: '1 KB',
      sizeBytes: 10,
    }))
    // old page 5 of 5 -> last page of the new manifest
    expect(remapPage(oldPages, allDifferent, 5)).toBe(3)
    // old page 1 of 5 -> first page of the new manifest
    expect(remapPage(oldPages, allDifferent, 1)).toBe(1)
  })

  test('clamps unknown sources into the valid range', () => {
    expect(remapPage([], [page(1), page(2)], 9)).toBe(2)
  })
})

describe('dateToken', () => {
  test('normalizes dates to ISO strings and passes through garbage', () => {
    expect(dateToken('2024-01-02T03:04:05Z')).toBe('2024-01-02T03:04:05.000Z')
    expect(dateToken(undefined)).toBe('')
    expect(dateToken(null)).toBe('')
    expect(dateToken('not-a-date')).toBe('not-a-date')
  })
})

describe('pageFromItems', () => {
  const items = [{ n: 3 }, { n: 1 }, { n: 2 }]

  test('sorts ascending and descending and pages the result', () => {
    const asc = pageFromItems(items, { sort: ['n'], page: 0, size: 2 })
    expect(asc.content).toEqual([{ n: 1 }, { n: 2 }])
    expect(asc.totalElements).toBe(3)
    expect(asc.totalPages).toBe(2)
    expect(asc.first).toBe(true)
    expect(asc.last).toBe(false)

    const desc = pageFromItems(items, { sort: ['n,desc'], page: 1, size: 2 })
    expect(desc.content).toEqual([{ n: 1 }])
    expect(desc.last).toBe(true)
  })

  test('supports unpaged requests and clamps out-of-range pages', () => {
    const unpaged = pageFromItems(items, { unpaged: true })
    expect(unpaged.content).toHaveLength(3)
    expect(unpaged.last).toBe(true)

    const clamped = pageFromItems(items, { page: 9, size: 2 })
    expect(clamped.number).toBe(1)
    expect(clamped.content).toEqual([{ n: 2 }])

    const empty = pageFromItems([], { page: 0, size: 20 })
    expect(empty.empty).toBe(true)
    expect(empty.totalPages).toBe(0)
  })
})

describe('offline search filters', () => {
  const book = {
    libraryId: 'lib1',
    seriesId: 'series1',
    readProgress: { completed: false },
    media: { status: 'READY', mediaProfile: 'DIVINA' },
    oneshot: false,
    deleted: false,
    name: 'Book One',
    seriesTitle: 'Great Series',
    metadata: {
      title: 'Book One',
      titleSort: 'book one',
      status: 'ONGOING',
      language: 'en',
      publisher: 'ACME',
      tags: ['adventure'],
      genres: ['manga'],
      authors: [{ name: 'Jane Doe' }],
    },
  }

  test('operatorMatches covers the classic operator set', () => {
    expect(operatorMatches('a', { operator: 'is', value: 'a' })).toBe(true)
    expect(operatorMatches(['a'], { operator: 'is', value: 'a' })).toBe(true)
    expect(operatorMatches('a', { operator: 'isNot', value: 'b' })).toBe(true)
    expect(operatorMatches(true, { operator: 'isTrue' })).toBe(true)
    expect(operatorMatches(false, { operator: 'isFalse' })).toBe(true)
    expect(operatorMatches(undefined, { operator: 'isNull' })).toBe(true)
    expect(operatorMatches(0, { operator: 'isNotNull' })).toBe(true)
    expect(operatorMatches('2020-01-01', { operator: 'before', dateTime: '2021-01-01' })).toBe(true)
    expect(operatorMatches('2022-01-01', { operator: 'after', dateTime: '2021-01-01' })).toBe(true)
    expect(operatorMatches('Hello', { operator: 'beginsWith', value: 'he' })).toBe(true)
    expect(operatorMatches('Hello', { operator: 'doesNotBeginWith', value: 'bye' })).toBe(true)
    expect(operatorMatches('x', { operator: 'whatever' })).toBe(true)
    expect(operatorMatches('x', undefined)).toBe(true)
  })

  test('conditionMatches filters on known fields and stays permissive otherwise', () => {
    expect(conditionMatches(book, {})).toBe(true)
    expect(conditionMatches(book, { libraryId: { operator: 'is', value: 'lib1' } })).toBe(true)
    expect(conditionMatches(book, { libraryId: { operator: 'is', value: 'lib2' } })).toBe(false)
    expect(conditionMatches(book, { readStatus: { operator: 'is', value: 'IN_PROGRESS' } })).toBe(
      true,
    )
    expect(conditionMatches(book, { tag: { operator: 'is', value: 'adventure' } })).toBe(true)
    expect(conditionMatches(book, { complete: { operator: 'isTrue' } })).toBe(false)
    expect(conditionMatches(book, { someFutureFilter: { operator: 'is', value: 'x' } })).toBe(true)
    expect(
      conditionMatches(book, {
        allOf: [
          { libraryId: { operator: 'is', value: 'lib1' } },
          { tag: { operator: 'is', value: 'nope' } },
        ],
      }),
    ).toBe(false)
  })

  test('fullTextMatches searches titles, series and authors', () => {
    expect(fullTextMatches(book, '')).toBe(true)
    expect(fullTextMatches(book, 'great series')).toBe(true)
    expect(fullTextMatches(book, 'JANE')).toBe(true)
    expect(fullTextMatches(book, 'missing')).toBe(false)
  })

  test('library helpers detect library-only selections', () => {
    expect(conditionUsesOnlyLibrarySelection({})).toBe(true)
    expect(conditionUsesOnlyLibrarySelection({ libraryId: { operator: 'is', value: 'a' } })).toBe(
      true,
    )
    expect(conditionUsesOnlyLibrarySelection({ tag: { operator: 'is', value: 'a' } })).toBe(false)
    expect(libraryIdsFromCondition({ libraryId: { operator: 'is', value: 'lib1' } })).toEqual([
      'lib1',
    ])
    expect(libraryIdsFromCondition({ tag: { operator: 'is', value: 'x' } })).toEqual([])
    expect(
      libraryIdsFromCondition({
        allOf: [
          { libraryId: { operator: 'is', value: 'a' } },
          { libraryId: { operator: 'is', value: 'b' } },
        ],
      }),
    ).toEqual(['a', 'b'])
  })

  test('uniqueStrings dedupes while dropping empties', () => {
    expect(uniqueStrings(['a', 'b', 'a', undefined, null, ''])).toEqual(['a', 'b'])
  })
})

describe('queue state', () => {
  function record(
    bookId: string,
    status: OfflineDownloadRecord['status'],
    queuedAt?: string,
  ): OfflineDownloadRecord {
    return {
      bookId,
      book: { id: bookId } as OfflineDownloadRecord['book'],
      status,
      totalPages: 10,
      completedPages: 0,
      bytes: 0,
      queuedAt,
    }
  }

  test('selectNextQueuedDownload picks the oldest idle queued record', () => {
    const downloads = [
      record('new', 'queued', '2024-02-01T00:00:00.000Z'),
      record('old', 'queued', '2024-01-01T00:00:00.000Z'),
      record('busy', 'downloading', '2023-01-01T00:00:00.000Z'),
      record('paused', 'paused', '2023-06-01T00:00:00.000Z'),
    ]
    expect(selectNextQueuedDownload(downloads, new Set(['old']))?.bookId).toBe('new')
    expect(selectNextQueuedDownload(downloads, new Set(['old', 'new']))).toBeUndefined()
  })

  test('summarizeDownloadGroup aggregates notification state', () => {
    const summary = summarizeDownloadGroup([
      { status: 'downloaded', totalPages: 10, completedPages: 10 },
      { status: 'downloading', totalPages: 10, completedPages: 3 },
      { status: 'queued', totalPages: 10, completedPages: 0 },
      { status: 'error', totalPages: 10, completedPages: 0, error: 'boom' },
    ])
    expect(summary).toMatchObject({
      totalPages: 40,
      completedPages: 13,
      downloaded: 1,
      active: 1,
      queued: 1,
      failed: 1,
      finished: false,
      percent: 32,
    })

    const finished = summarizeDownloadGroup([
      { status: 'downloaded', totalPages: 4, completedPages: 4 },
    ])
    expect(finished.finished).toBe(true)
    expect(finished.percent).toBe(100)

    const empty = summarizeDownloadGroup([])
    expect(empty.percent).toBe(0)
    expect(empty.finished).toBe(true)
  })
})

describe('rehydrateDates', () => {
  test('revives ISO strings without touching other values', () => {
    const input = { at: '2024-01-02T03:04:05Z', nested: { at: '2024-01-03' }, count: 3, name: 'x' }
    const out = rehydrateDates(input)
    expect(out.at).toBeInstanceOf(Date)
    expect(out.count).toBe(3)
    expect(out.name).toBe('x')
  })
})

describe('stringifyFilterValue and errorMessage', () => {
  test('stringifies like a template literal', () => {
    expect(stringifyFilterValue('a')).toBe('a')
    expect(stringifyFilterValue(0)).toBe('0')
    expect(stringifyFilterValue(undefined)).toBe('undefined')
  })

  test('errorMessage prefers Error.message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
  })
})
