// @ts-nocheck
/* eslint-env jest */
// Types for node builtins and the untyped generator are unavailable to this
// standalone script test (@types/node is not installed); runtime is unaffected.
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('fs/promises')
const { tmpdir } = require('os')
const { join } = require('path')
const { createHash } = require('crypto')
const { collectShellEntries, buildShellManifest, writeShellManifest } = require('./generate-shell-manifest')

async function makeFakeDist() {
  const dist = await mkdtemp(join(tmpdir(), 'webui-dist-'))
  await writeFile(join(dist, 'index.html'), '<html></html>')
  await mkdir(join(dist, 'js'), { recursive: true })
  await writeFile(join(dist, 'js', 'app-abc123.js'), 'console.log(1)')
  await writeFile(join(dist, 'js', 'chunk-def456.js'), 'chunk')
  await mkdir(join(dist, 'css'), { recursive: true })
  await writeFile(join(dist, 'css', 'app-ghi789.css'), 'body{}')
  return dist
}

describe('collectShellEntries', () => {
  test('lists every file with posix-relative url, size, and sha256, sorted', async () => {
    const dist = await makeFakeDist()
    try {
      const entries = await collectShellEntries(dist, new Set())
      expect(entries.map((entry) => entry.url)).toEqual([
        'css/app-ghi789.css',
        'index.html',
        'js/app-abc123.js',
        'js/chunk-def456.js',
      ])
      const js = entries.find((entry) => entry.url === 'js/app-abc123.js')
      expect(js.size).toBe('console.log(1)'.length)
      expect(js.sha256).toBe(createHash('sha256').update('console.log(1)').digest('hex'))
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })
})

describe('writeShellManifest', () => {
  test('writes correct JSON and excludes itself', async () => {
    const dist = await makeFakeDist()
    try {
      const manifest = await writeShellManifest({
        distDir: dist,
        manifestFileName: 'webui-shell.json',
        app: 'webui',
      })

      expect(manifest).toEqual(buildShellManifest('webui', manifest.files))
      expect(manifest.app).toBe('webui')
      expect(manifest.version).toBe(1)
      expect(manifest.files.map((file) => file.url)).toEqual([
        'css/app-ghi789.css',
        'index.html',
        'js/app-abc123.js',
        'js/chunk-def456.js',
      ])

      const onDisk = JSON.parse(await readFile(join(dist, 'webui-shell.json'), 'utf8'))
      expect(onDisk).toEqual(JSON.parse(JSON.stringify(manifest)))

      // Regenerating over an existing manifest still excludes the manifest itself.
      const second = await writeShellManifest({
        distDir: dist,
        manifestFileName: 'webui-shell.json',
        app: 'webui',
      })
      expect(second.files.map((file) => file.url)).not.toContain('webui-shell.json')
      expect(second.revision).toBe(manifest.revision)
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })
})
