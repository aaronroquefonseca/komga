# Offline behavior and verification

Next UI caches visited catalog metadata. **Downloads** contains the books whose
page images are saved on this device. Cached catalog entries can be browsed but
are not readable until their download finishes. Reading opens the classic
reader; offline setup therefore prepares both application shells.

Offline and explicit offline mode show a persistent notice with Downloads and
Reconnect actions. Server-only pages show **Unavailable offline** rather than an
empty table or a generic error. Book/series details that were never saved show
the same state. Editing, importing, server management and remote download actions
are disabled offline. EPUB publications require a connection; offline downloads
currently support image-based comics. A missing comic page shows a warning with
Retry and Downloads actions.

## Automated production regression

From the repository root:

```sh
npm --prefix komga-webui run build
npm --prefix next-ui run build:with-i18n
npm --prefix next-ui exec -- playwright install chromium
npm --prefix next-ui run test:offline
```

The test serves actual production bundles with a deterministic API fixture. It
uses the real download store, Cache Storage, IndexedDB and service worker; closes
the entire browser process; restarts with networking disabled; and checks:

- cold launch to Downloads and an unvisited book detail;
- uncached details and server-only pages;
- next UI to classic reader handoff and actual image decoding;
- reader reload retaining `/classic/` so the correct HTML is selected;
- network-only revision downloads with changed image bytes;
- failed precache assets preventing readiness, followed by successful repair;
- unavailable server responses falling back to cached HTML and catalog;
- different accounts retaining separate downloads, without deleting old copies;
- a removed session preventing offline authentication and cached media access.

The test disables browser networking and makes the fixture server unreachable too,
so service-worker fetches cannot bypass the offline simulation. It also delays an
old account's catalog response across an account switch and rejects unsupported
EPUB downloads before queuing them.

The server fixture models Gradle/Thymeleaf's absolute HTML asset URLs. These tests
are browser integration tests, not a replacement for the real-device checks below.

## Readiness and updates

Downloads reports **Offline app shell is ready** only after both manifests, both
HTML entries and all required assets are cached successfully. Failed or incomplete
preparation displays a retry action. Readiness is persisted and rechecked after a
worker restart or asset eviction. A navigation does not overwrite the last complete
HTML with a partially prepared update. Hashed assets from older builds stay cached
so already-open pages remain usable during updates.

## Real phone acceptance checks

Run against the deployed build in Android Chrome and iOS Safari, including an
installed home-screen PWA:

1. Sign in online, open Downloads, and wait for setup to report ready. Download
   one image-based comic. Avoid visiting another book detail or the reader.
2. Enable airplane mode. Force-close the app/browser and reopen it from the
   home-screen icon. Downloads and the saved comic must load without signing in.
3. Open the comic; turn pages, close/reopen it, and reload the reader. Check that
   the URL retains `/classic/`. Progress must be retained while offline.
4. Open an uncached book and History/settings. Check the unavailable message and
   the Downloads action. Check that server mutation actions are disabled.
5. Disable airplane mode and choose Reconnect. Confirm progress synchronizes with
   the same account. Repeat while Wi-Fi remains connected but the server is stopped.
6. Redeploy, visit online until setup is ready, then repeat the cold launch.
7. Simulate a failed asset request during preparation: setup must remain incomplete
   until Retry succeeds. Delete one downloaded page from Cache Storage: the reader
   must show a missing-page warning instead of a blank image.
8. Log out and launch offline. The previous identity must not be restored. Sign in
   as another account online: the first account's catalog, downloads and progress
   must remain isolated. Signing back into the original account restores its copies.

Databases and media cache names are scoped by deployment and account. Existing
root-deployment data is retained for its original account; changing accounts
selects another database. Logging out removes the local session and retains the
account's downloaded copies for its next sign-in.
