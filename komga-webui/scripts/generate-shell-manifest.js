/**
 * Emits a shell asset manifest for the production build.
 *
 * Scans the vue-cli `dist/` output and writes `webui-shell.json` next to it,
 * listing every file (relative URL, byte size, sha256). The app fetches this
 * manifest while online and precaches every listed asset in the service
 * worker shell cache, so any route cold-boots offline - including routes
 * whose lazy chunks were never visited and post-update shells whose hashed
 * filenames changed.
 *
 * Dependency-free: node builtins only, so it runs in CI with plain `node`.
 */
const { readdir, readFile, stat, writeFile } = require('fs/promises')
const { createHash } = require('crypto')
const { dirname, join, relative, resolve, sep } = require('path')

async function collectShellEntries(distDir, excludeFileNames = new Set()) {
  const entries = []

  async function walk(dir) {
    const names = await readdir(dir)
    names.sort()
    for (const name of names) {
      const absolute = join(dir, name)
      const stats = await stat(absolute)
      if (stats.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!stats.isFile()) continue
      const url = relative(distDir, absolute).split(sep).join('/')
      if (excludeFileNames.has(url)) continue
      const content = await readFile(absolute)
      entries.push({
        url,
        size: stats.size,
        sha256: createHash('sha256').update(content).digest('hex'),
      })
    }
  }

  await walk(distDir)
  entries.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  return entries
}

function buildShellManifest(app, files) {
  const revision = createHash('sha256').update(JSON.stringify({ app, files: [...files].sort((a, b) => a.url.localeCompare(b.url)) })).digest('hex')
  return { app, version: 1, revision, files }
}

async function writeShellManifest({ distDir, manifestFileName, app, extraExcludes = [] }) {
  const files = await collectShellEntries(distDir, new Set([manifestFileName, ...extraExcludes]))
  const manifest = buildShellManifest(app, files)
  await writeFile(join(distDir, manifestFileName), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

module.exports = { collectShellEntries, buildShellManifest, writeShellManifest }

if (require.main === module) {
  const distDir = resolve(dirname(__filename), '..', 'dist')
  writeShellManifest({ distDir, manifestFileName: 'webui-shell.json', app: 'webui' })
    .then((manifest) => console.log(`wrote webui-shell.json with ${manifest.files.length} files`))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
