// Pure helpers for offline shell precaching.
// The build emits webui-shell.json into dist/ (see scripts/generate-shell-manifest.js);
// main.ts fetches it while online and precaches every listed asset so any route
// cold-boots offline, including unvisited lazy chunks and post-update hashed files.

export const WEBUI_SHELL_MANIFEST_FILENAME = 'webui-shell.json'

export interface ShellManifestFile {
  url?: unknown
}

// Liberal parser for the build-time shell manifest. Accepts the emitted shape
// {app, version, files: [{url, size, sha256}]} as well as plain string arrays,
// so older/newer manifests degrade to a usable URL list.
export function parseShellManifest(data: unknown): string[] {
  const files = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { files?: unknown }).files)
      ? (data as { files: unknown[] }).files
      : []
  const urls: string[] = []
  for (const file of files) {
    if (typeof file === 'string') {
      if (file) urls.push(file)
    } else if (typeof file === 'object' && file !== null && typeof (file as ShellManifestFile).url === 'string') {
      const url = (file as { url: string }).url
      if (url) urls.push(url)
    }
  }
  return urls
}

// Resolve manifest-relative URLs against the resource base; drop cross-origin/invalid entries.
export function resolveShellAssetUrls(rawUrls: string[], baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const resolved: string[] = []
  for (const rawUrl of rawUrls) {
    if (!rawUrl.trim()) continue
    try {
      const url = new URL(rawUrl, base)
      if (url.origin === base.origin) resolved.push(url.href)
    } catch (e) {
      // One malformed entry must not prevent the rest of the shell being cached.
    }
  }
  return resolved
}

// Merge asset lists, preserving first-seen order.
export function mergeShellAssets(...lists: string[][]): string[] {
  return [...new Set(lists.flat())]
}
