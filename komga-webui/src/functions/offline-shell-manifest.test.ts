/* eslint-env jest */
import { mergeShellAssets, parseShellManifest, resolveShellAssetUrls } from '@/functions/offline-shell-manifest'

describe('parseShellManifest', () => {
  test('accepts the emitted object shape', () => {
    expect(parseShellManifest({
      app: 'webui',
      version: 1,
      files: [
        { url: 'js/app.js', size: 1, sha256: 'x' },
        { url: '', size: 0, sha256: 'y' },
      ],
    })).toEqual(['js/app.js'])
  })

  test('accepts plain string arrays and bare arrays', () => {
    expect(parseShellManifest({ files: ['a.js', 42, null] })).toEqual(['a.js'])
    expect(parseShellManifest([{ url: 'b.js' }, 'c.js'])).toEqual(['b.js', 'c.js'])
  })

  test('rejects garbage', () => {
    expect(parseShellManifest(null)).toEqual([])
    expect(parseShellManifest('nope')).toEqual([])
    expect(parseShellManifest({})).toEqual([])
    expect(parseShellManifest({ files: 'nope' })).toEqual([])
  })
})

describe('resolveShellAssetUrls', () => {
  test('resolves dist-relative urls against the base and drops cross-origin entries', () => {
    expect(resolveShellAssetUrls(
      ['js/a.js', '/komga/b.css', 'https://cdn.example.com/c.js', 'https://', ''],
      'https://example.com/komga/',
    )).toEqual(['https://example.com/komga/js/a.js', 'https://example.com/komga/b.css'])
  })
})

describe('mergeShellAssets', () => {
  test('dedupes while preserving first-seen order', () => {
    expect(mergeShellAssets(['a', 'b'], ['b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })
})
