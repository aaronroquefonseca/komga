import { describe, expect, test } from 'vitest'
import type { OfflineDownloadRecord } from './offline-types'
import { formatBytes, getDownloadBadges, groupDownloadsBySeries } from './offline-downloads'

function record(
  bookId: string,
  seriesId: string,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    bookId,
    book: {
      id: bookId,
      seriesId,
      seriesTitle: `Series ${seriesId}`,
      metadata: { numberSort: Number(bookId.slice(-1)) || 0, title: bookId },
    } as unknown as OfflineDownloadRecord['book'],
    status: 'downloaded',
    totalPages: 10,
    completedPages: 10,
    bytes: 100,
    ...overrides,
  }
}

describe('groupDownloadsBySeries', () => {
  test('groups by series, sorts by numberSort, and summarizes', () => {
    const downloads = [
      record('b2', 's1', { status: 'downloading', bytes: 50, completedPages: 3 }),
      record('b1', 's1', { status: 'downloaded', bytes: 200 }),
      record('b3', 's2', { status: 'error', error: 'boom', bytes: 0 }),
    ]
    const groups = groupDownloadsBySeries(downloads)
    expect(groups).toHaveLength(2)

    const s1 = groups.find((g) => g.seriesId === 's1')!
    expect(s1.title).toBe('Series s1')
    expect(s1.downloads.map((d) => d.bookId)).toEqual(['b1', 'b2'])
    expect(s1.downloaded).toBe(1)
    expect(s1.failed).toBe(0)
    expect(s1.bytes).toBe(250)

    const s2 = groups.find((g) => g.seriesId === 's2')!
    expect(s2.downloaded).toBe(0)
    expect(s2.failed).toBe(1)
  })

  test('counts rows with a kept-copy error as failed', () => {
    const downloads = [record('b1', 's1', { status: 'downloaded', error: 'update boom' })]
    const [group] = groupDownloadsBySeries(downloads)
    expect(group?.failed).toBe(1)
    expect(group?.downloaded).toBe(1)
  })

  test('returns an empty list when there are no downloads', () => {
    expect(groupDownloadsBySeries([])).toEqual([])
  })
})

describe('formatBytes', () => {
  test('formats zero and scales units like the classic view', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })
})

describe('getDownloadBadges', () => {
  test('only downloaded rows produce badges', () => {
    expect(getDownloadBadges({ status: 'downloading' })).toEqual([])
    expect(
      getDownloadBadges({
        status: 'downloaded',
        updateAvailable: true,
        sourceMissing: true,
        error: 'boom',
      }),
    ).toEqual(['update-available', 'source-missing', 'update-failed'])
    expect(getDownloadBadges({ status: 'downloaded' })).toEqual([])
  })
})
