import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  buildShellManifest,
  collectShellEntries,
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

      expect(manifest).toEqual(buildShellManifest('nextui', manifest.files))
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
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })
})
