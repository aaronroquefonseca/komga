# Manual phone test: offline PWA shell precache

Covers the per-app shell manifests (`webui-shell.json`, `nextui-shell.json`)
and service-worker precaching of the full app shell. Run on a real phone
(Android Chrome and iOS Safari) against a deployed build.

## 1. Fresh install precaches the whole shell

1. On desktop Chrome, open the app online and confirm the manifest for the UI
   under test is served:
   - classic: `GET <base>/webui-shell.json` (200, lists `js/*`, `css/*`, …)
   - next UI: `GET <base>/nextui-shell.json` (200, no `index.html` entry)
2. Open DevTools → Application → Cache Storage → `komga-shell-v3` and confirm
   it contains every manifest-listed file, not just the current page's chunks.
3. On the phone, open the app online once, then visit one route only
   (e.g. the library list). Do NOT visit other routes.

## 2. Unvisited routes cold-boot offline

1. On the phone, enable airplane mode.
2. Force-close the browser/PWA and cold-boot from the home-screen icon.
3. Open a route never visited in step 1 (e.g. settings, a reader, history):
   expect the app shell to render, not a blank white page.
4. Repeat for the other UI (`/classic/**` vs `/next/**`); each UI precaches
   only its own `*-shell.json` plus the shared icons/fonts.

## 3. Post-update offline boots keep working

1. Redeploy (new hashed JS/CSS filenames), then open the app online once so
   the new service worker activates and the new shell is cached.
2. Enable airplane mode, force-close, and cold-boot from the home-screen icon:
   expect the new shell to render offline with no blank page or 504s.
3. In DevTools (desktop), confirm the old hashed chunks are gone from the
   shell cache and the new manifest's files are all present.

## 4. Failure signatures

- Blank white page on offline cold boot → the open page's chunks 404 in the
  shell cache; check that the manifest was fetched (Network tab, online run)
  and that `webui-shell.json` / `nextui-shell.json` are deployed under
  `resources/public/` (Gradle `webuiCopyDist` / `nextuiCopyDist` must not
  exclude them; only `index.html` is excluded from the next-ui copy because
  it is renamed to `index-next.html`).
- One UI works offline but the other does not → that UI's manifest is missing
  or its `prepareOfflineShell` never ran online (check `KOMGA_PREPARE_OFFLINE_SHELL`
  handling with the worker's offline-status message channel).
