/**
 * Emits a shell asset manifest for the production build.
 *
 * Scans the Vite `dist/` output and writes `nextui-shell.json` next to it,
 * listing every file (relative URL, byte size, sha256). The app fetches this
 * manifest while online and precaches every listed asset in the service
 * worker shell cache, so any route cold-boots offline — including routes
 * whose lazy chunks were never visited and post-update shells whose hashed
 * filenames changed.
 *
 * Dependency-free: node builtins only, so it runs in CI with `tsx`.
 * `index.html` is excluded: Gradle copies it separately as `index-next.html`,
 * so the dist-relative URL would 404 at runtime.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface ShellManifestEntry {
  url: string
  size: number
  sha256: string
}

export interface ShellManifest {
  app: string
  version: 1
  files: ShellManifestEntry[]
}

export interface WriteShellManifestOptions {
  distDir: string
  manifestFileName: string
  app: string
  extraExcludes?: string[]
}

/** Recursively list every file under `distDir`, sorted by posix-relative URL. */
export async function collectShellEntries(
  distDir: string,
  excludeFileNames: ReadonlySet<string> = new Set(),
): Promise<ShellManifestEntry[]> {
  const entries: ShellManifestEntry[] = []

  async function walk(dir: string): Promise<void> {
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

export function buildShellManifest(app: string, files: ShellManifestEntry[]): ShellManifest {
  return { app, version: 1, files }
}

export async function writeShellManifest(
  options: WriteShellManifestOptions,
): Promise<ShellManifest> {
  const { distDir, manifestFileName, app, extraExcludes = [] } = options
  const files = await collectShellEntries(distDir, new Set([manifestFileName, ...extraExcludes]))
  const manifest = buildShellManifest(app, files)
  await writeFile(join(distDir, manifestFileName), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function isMainModule(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return pathToFileURL(resolve(invoked)).href === pathToFileURL(fileURLToPath(import.meta.url)).href
}

if (isMainModule()) {
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  const manifest = await writeShellManifest({
    distDir,
    manifestFileName: 'nextui-shell.json',
    app: 'nextui',
    extraExcludes: ['index.html'],
  })
  console.log(`wrote nextui-shell.json with ${manifest.files.length} files`)
}
