import { describe, expect, test } from 'vitest'
import { isOwnOfflineBookCache, offlineMediaCachePrefix } from './offline-db'

// Default account in tests: activeDatabaseName is 'komga-offline', so the
// prefix below is the default account's book-cache prefix.
const ownPrefix = offlineMediaCachePrefix()
const ownCache = `${ownPrefix}abcdef12-200-a1b2c3d4`
// A per-user account cache name as seen from the default account: it shares
// the default prefix as a string prefix, so a plain startsWith check would
// wrongly claim it.
const otherAccountCache = `${ownPrefix}user-B-abcdef12-200-a1b2c3d4`

describe('isOwnOfflineBookCache', () => {
  test('accepts own account cache names', () => {
    expect(isOwnOfflineBookCache(ownCache)).toBe(true)
  })

  test('rejects another account cache that shares the prefix', () => {
    expect(otherAccountCache.startsWith(ownPrefix)).toBe(true)
    expect(isOwnOfflineBookCache(otherAccountCache)).toBe(false)
  })

  test('rejects unrelated caches and malformed suffixes', () => {
    expect(isOwnOfflineBookCache('komga-shell-v3')).toBe(false)
    expect(isOwnOfflineBookCache(`${ownPrefix}notahash`)).toBe(false)
    expect(isOwnOfflineBookCache(`${ownPrefix}abcdef12`)).toBe(false)
  })
})
