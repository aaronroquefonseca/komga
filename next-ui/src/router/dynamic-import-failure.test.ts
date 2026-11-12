import { describe, expect, test } from 'vitest'
import { decideDynamicImportRecovery, isDynamicImportError } from '@/router/dynamic-import-failure'

const DYNAMIC_IMPORT_ERROR = new Error(
  'Failed to fetch dynamically imported module: ./pages/foo.vue',
)

describe('isDynamicImportError', () => {
  test('matches vite dynamic import failures only', () => {
    expect(isDynamicImportError(DYNAMIC_IMPORT_ERROR)).toBe(true)
    expect(isDynamicImportError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isDynamicImportError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isDynamicImportError(new Error('boom'))).toBe(false)
    expect(isDynamicImportError(undefined)).toBe(false)
    expect(isDynamicImportError({ message: 42 })).toBe(false)
  })
})

describe('decideDynamicImportRecovery', () => {
  test('reloads online when the chunk was never retried', () => {
    expect(
      decideDynamicImportRecovery({
        error: DYNAMIC_IMPORT_ERROR,
        online: true,
        alreadyRetried: false,
        isErrorRoute: false,
      }),
    ).toBe('reload')
  })

  test('falls back to the error page offline instead of reloading', () => {
    expect(
      decideDynamicImportRecovery({
        error: DYNAMIC_IMPORT_ERROR,
        online: false,
        alreadyRetried: false,
        isErrorRoute: false,
      }),
    ).toBe('error-page')
  })

  test('gives up after a retry, on the error route, or for other errors', () => {
    const base = {
      error: DYNAMIC_IMPORT_ERROR,
      online: false,
      alreadyRetried: false,
      isErrorRoute: false,
    }
    expect(decideDynamicImportRecovery({ ...base, alreadyRetried: true })).toBe('error-page')
    expect(decideDynamicImportRecovery({ ...base, isErrorRoute: true })).toBe('none')
    expect(decideDynamicImportRecovery({ ...base, error: new Error('boom') })).toBe('none')
  })
})
