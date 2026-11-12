import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  buildShellManifest,
  collectShellEntries,
  criticalAssetRank,
  orderShellEntries,
  writeShellManifest,
} from './generate-shell-manifest'

async function makeFakeDist(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'nextui-dist-'))
  await writeFile(join(dist, 'index.html'), '<html></html>')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)')
  await writeFile(join(dist, 'assets', 'index-def456.css'), 'body{}')
  await mkdir(join(dist, 'fonts'), { recursive: true })
  await writeFile(join(dist, 'fonts', 'roboto.woff2'), 'fakefont')
  return dist
}

describe('collectShellEntries', () => {
  test('lists every file with posix-relative url, size, and sha256, sorted', async () => {
    const dist = await makeFakeDist()
    try {
      const entries = await collectShellEntries(dist, new Set(['index.html']))
      expect(entries.map((entry) => entry.url)).toEqual([
        'assets/index-abc123.js',
        'assets/index-def456.css',
        'fonts/roboto.woff2',
      ])
      const js = entries.find((entry) => entry.url === 'assets/index-abc123.js')
      expect(js?.size).toBe('console.log(1)'.length)
      expect(js?.sha256).toBe(createHash('sha256').update('console.log(1)').digest('hex'))
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })

  test('emits critical fallback chunks before the rest of the shell', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'nextui-dist-'))
    try {
      await mkdir(join(dist, 'assets'), { recursive: true })
      for (const name of [
        'zzz-last.js',
        'error-aaa.js',
        'books-bbb.js',
        'login-ccc.js',
        'layout-ddd.js',
        'index-eee.js',
      ]) {
        await writeFile(join(dist, 'assets', name), 'x')
      }
      const entries = await collectShellEntries(dist, new Set())
      expect(entries.map((entry) => entry.url)).toEqual([
        'assets/index-eee.js',
        'assets/login-ccc.js',
        'assets/error-aaa.js',
        'assets/layout-ddd.js',
        'assets/books-bbb.js',
        'assets/zzz-last.js',
      ])
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })
})

describe('criticalAssetRank', () => {
  test('ranks the boot and fallback chunks before everything else', () => {
    expect(criticalAssetRank('assets/index-abc123.js')).toBe(0)
    expect(criticalAssetRank('assets/login-def456.js')).toBe(1)
    expect(criticalAssetRank('assets/error-ghi789.js')).toBe(2)
    expect(criticalAssetRank('assets/layout-jkl012.js')).toBe(3)
    expect(criticalAssetRank('assets/VNavigationDrawer-mno345.js')).toBe(4)
    expect(criticalAssetRank('assets/books-pqr678.js')).toBe(5)
  })

  test('does not promote lookalike chunk names', () => {
    expect(criticalAssetRank('assets/errorCodeFormatter-abc.js')).toBe(5)
    expect(criticalAssetRank('assets/EmptyStateNetworkError-abc.js')).toBe(5)
  })
})

describe('orderShellEntries', () => {
  test('moves critical chunks first and keeps sorted order within each tier', () => {
    const entries = [
      'assets/VNavigationDrawer-jkl.js',
      'assets/books-abc.js',
      'assets/error-ghi.js',
      'assets/index-mno.js',
      'assets/layout-pqr.js',
      'assets/login-def.js',
      'assets/zzz.js',
      'fonts/font.woff2',
    ].map((url) => ({ url, size: 1, sha256: 'x' }))
    expect(orderShellEntries(entries).map((entry) => entry.url)).toEqual([
      'assets/index-mno.js',
      'assets/login-def.js',
      'assets/error-ghi.js',
      'assets/layout-pqr.js',
      'assets/VNavigationDrawer-jkl.js',
      'assets/books-abc.js',
      'assets/zzz.js',
      'fonts/font.woff2',
    ])
  })
})

describe('writeShellManifest', () => {
  test('writes correct JSON and excludes itself plus extra excludes', async () => {
    const dist = await makeFakeDist()
    try {
      const manifest = await writeShellManifest({
        distDir: dist,
        manifestFileName: 'nextui-shell.json',
        app: 'nextui',
        extraExcludes: ['index.html'],
      })

      expect(manifest).toEqual(buildShellManifest('nextui', manifest.files, '<html></html>'))
      expect(manifest.app).toBe('nextui')
      expect(manifest.version).toBe(1)
      expect(manifest.files.map((file) => file.url)).toEqual([
        'assets/index-abc123.js',
        'assets/index-def456.css',
        'fonts/roboto.woff2',
      ])

      const onDisk = JSON.parse(await readFile(join(dist, 'nextui-shell.json'), 'utf8'))
      expect(onDisk).toEqual(JSON.parse(JSON.stringify(manifest)))

      // Regenerating over an existing manifest still excludes the manifest itself.
      const second = await writeShellManifest({
        distDir: dist,
        manifestFileName: 'nextui-shell.json',
        app: 'nextui',
        extraExcludes: ['index.html'],
      })
      expect(second.files.map((file) => file.url)).not.toContain('nextui-shell.json')
      expect(second.revision).toBe(manifest.revision)
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })
})

describe('shell content identity', () => {
  test('is stable for identical content and changes for assets or HTML', () => {
    const files = [{ url: 'a.js', size: 1, sha256: 'old' }]
    const original = buildShellManifest('nextui', files, 'html')
    expect(buildShellManifest('nextui', [...files], 'html').revision).toBe(original.revision)
    expect(
      buildShellManifest('nextui', [{ ...files[0], sha256: 'new' }], 'html').revision,
    ).not.toBe(original.revision)
    expect(buildShellManifest('nextui', files, 'changed html').revision).not.toBe(original.revision)
  })
})
