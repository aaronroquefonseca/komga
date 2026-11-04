<template>
  <v-container
    fluid
    class="pa-4 pa-sm-6"
  >
    <v-row align="center">
      <v-col>
        <div class="text-h5">
          {{
            $formatMessage({
              description: 'Downloads page: title',
              defaultMessage: 'Downloads',
              id: '8K+Ymt',
            })
          }}
        </div>
        <div class="text-caption text-medium-emphasis">
          {{
            $formatMessage({
              description: 'Downloads page: subtitle',
              defaultMessage: 'Books saved on this device for offline reading',
              id: 'de4dox',
            })
          }}
        </div>
      </v-col>
      <v-col cols="auto">
        <v-switch
          :model-value="offline.offlineMode"
          :label="
            $formatMessage({
              description: 'Downloads page: offline mode',
              defaultMessage: 'Offline mode',
              id: 'np/iRL',
            })
          "
          :loading="changingMode"
          hide-details
          class="mt-0"
          @update:model-value="changeOfflineMode"
        />
      </v-col>
    </v-row>

    <v-alert
      v-if="offline.offlineMode"
      type="info"
      variant="tonal"
      density="compact"
      class="mt-4"
    >
      {{
        $formatMessage({
          description: 'Downloads page: offline mode description',
          defaultMessage:
            'Offline mode blocks the Komga API and page streaming. Only cached metadata and downloaded pages are used.',
          id: 'G4phj2',
        })
      }}
    </v-alert>

    <v-card
      variant="outlined"
      class="my-4"
    >
      <v-card-text>
        <div class="d-flex align-center mb-2">
          <v-icon class="me-2">i-mdi:database</v-icon>
          <strong>{{
            $formatMessage({
              description: 'Downloads page: storage',
              defaultMessage: 'Storage',
              id: 'xFrlmW',
            })
          }}</strong>
          <v-spacer />
          <span class="text-caption">{{ storageText }}</span>
        </div>
        <v-progress-linear
          v-if="storage.quota > 0"
          :model-value="storagePercent"
          height="8"
          rounded
        />
        <div
          v-if="storage.quota > 0"
          class="text-caption text-medium-emphasis mt-2"
        >
          {{
            $formatMessage(
              {
                description: 'Downloads page: browser quota',
                defaultMessage: 'Browser quota: {quota}',
                id: 'WyYZnH',
              },
              { quota: formatBytes(storage.quota) },
            )
          }}
          ·
          {{
            $formatMessage(
              {
                description: 'Downloads page: browser headroom',
                defaultMessage: '{available} available',
                id: 'Saam0a',
              },
              { available: formatBytes(storageHeadroom) },
            )
          }}
        </div>
        <div class="text-caption text-medium-emphasis mt-1">
          {{
            $formatMessage(
              {
                description: 'Downloads page: catalog cached',
                defaultMessage: '{books} books and {series} series cached',
                id: '3wX7pE',
              },
              { books: offline.cachedBooks, series: offline.cachedSeries },
            )
          }}
        </div>
        <div
          class="text-body-2 mt-2"
          role="status"
        >
          {{ catalogStatusText }}
          <v-btn
            :disabled="!offline.online || offline.offlineMode"
            :loading="offline.syncingMetadata"
            variant="text"
            size="small"
            :text="
              $formatMessage({
                defaultMessage: 'Sync catalog',
                id: 'R43wiM',
                description: 'Downloads sync catalog button',
              })
            "
            @click="syncCatalog"
          />
        </div>
        <v-alert
          v-if="offline.catalogError"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{
            $formatMessage({
              defaultMessage:
                'Catalog sync did not finish. Saved entries remain available. Reconnect and retry Sync catalog.',
              id: 'JiSU+K',
              description: 'Downloads catalog sync error',
            })
          }}
        </v-alert>
        <div
          v-if="offline.shellReady !== 'unknown'"
          class="text-caption text-medium-emphasis mt-1"
        >
          {{ shellStatusText }}
          <v-btn
            v-if="offline.online && offline.shellReady !== 'ready'"
            variant="text"
            size="small"
            :text="
              $formatMessage({
                defaultMessage: 'Retry setup',
                id: '72ma37',
                description: 'Retry offline setup',
              })
            "
            @click="prepareOfflineShell(true)"
          />
        </div>
        <v-alert
          v-if="storage.quota > 0"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3 mb-0 text-caption"
        >
          {{
            $formatMessage({
              description: 'Downloads page: storage warning',
              defaultMessage:
                'Downloads share space with the browser profile. Removing offline copies frees space.',
              id: 'x3QxTc',
            })
          }}
        </v-alert>
      </v-card-text>
    </v-card>

    <v-card
      variant="outlined"
      class="my-4"
    >
      <v-card-title class="text-subtitle-1">
        {{
          $formatMessage({
            description: 'Downloads page: settings',
            defaultMessage: 'Download settings',
            id: '8TrwIS',
          })
        }}
      </v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col
            cols="12"
            sm="6"
          >
            <v-select
              :model-value="offline.preferences.concurrentBooks"
              :items="[1, 2, 3, 4, 6]"
              :label="
                $formatMessage({
                  description: 'Downloads page: parallel books',
                  defaultMessage: 'Parallel books',
                  id: 'pWVitk',
                })
              "
              hide-details
              @update:model-value="(value) => setPreference('concurrentBooks', value)"
            />
          </v-col>
          <v-col
            cols="12"
            sm="6"
          >
            <v-select
              :model-value="offline.preferences.concurrentPages"
              :items="[1, 2, 3, 4]"
              :label="
                $formatMessage({
                  description: 'Downloads page: parallel pages',
                  defaultMessage: 'Parallel pages',
                  id: 'QGj7WT',
                })
              "
              hide-details
              @update:model-value="(value) => setPreference('concurrentPages', value)"
            />
          </v-col>
        </v-row>
        <v-switch
          :model-value="offline.preferences.cacheCovers"
          :label="
            $formatMessage({
              defaultMessage: 'Keep browsed covers offline',
              id: '2gNaKC',
              description: 'Downloads cover caching preference',
            })
          "
          :hint="
            $formatMessage({
              defaultMessage:
                'Off by default. Saves book and series covers as you browse, using additional device storage. Turning this off removes these extra covers; downloaded book covers are kept.',
              id: 'H25Rdx',
              description: 'Downloads cover caching explanation',
            })
          "
          persistent-hint
          @update:model-value="(value) => setPreference('cacheCovers', value === true)"
        />
        <v-switch
          :model-value="notificationsEnabled"
          :label="
            $formatMessage({
              description: 'Downloads page: notifications',
              defaultMessage: 'Download notifications',
              id: 'BVMgIP',
            })
          "
          :hint="notificationHint"
          persistent-hint
          @update:model-value="toggleNotifications"
        />
        <v-switch
          :model-value="offline.preferences.removeRead"
          :label="
            $formatMessage({
              description: 'Downloads page: remove read',
              defaultMessage: 'Remove books automatically when finished',
              id: '4A3FI0',
            })
          "
          hide-details
          @update:model-value="(value) => setPreference('removeRead', value)"
        />
        <v-switch
          :model-value="offline.preferences.autoDownloadNext"
          :label="
            $formatMessage({
              description: 'Downloads page: auto download next',
              defaultMessage: 'Automatically download the next book',
              id: 'LgJVeS',
            })
          "
          :hint="
            $formatMessage({
              description: 'Downloads page: auto download hint',
              defaultMessage:
                'Keeps the next unread book ready. Starts once two consecutive books are stored.',
              id: 'Nwe7Ke',
            })
          "
          persistent-hint
          @update:model-value="(value) => setPreference('autoDownloadNext', value)"
        />
      </v-card-text>
    </v-card>

    <v-expansion-panels
      v-if="groups.length > 0"
      multiple
      variant="accordion"
    >
      <v-expansion-panel
        v-for="group in groups"
        :key="group.seriesId"
        :value="group.seriesId"
      >
        <template #title>
          <div class="d-flex align-center flex-grow-1 me-3">
            <div>
              <div class="font-weight-medium">{{ group.title }}</div>
              <div class="text-caption text-medium-emphasis">
                {{
                  $formatMessage(
                    {
                      description: 'Downloads page: series summary',
                      defaultMessage: '{downloaded} of {total} · {bytes}',
                      id: 'jCU4Cu',
                    },
                    {
                      downloaded: group.downloaded,
                      total: group.downloads.length,
                      bytes: formatBytes(group.bytes),
                    },
                  )
                }}
              </div>
            </div>
            <v-spacer />
            <v-btn
              v-if="group.failed"
              :disabled="!offline.online || offline.offlineMode"
              size="small"
              variant="text"
              color="warning"
              :title="
                $formatMessage(
                  {
                    description: 'Downloads page: retry failed',
                    defaultMessage: 'Retry {count} failed',
                    id: '0NFECk',
                  },
                  { count: group.failed },
                )
              "
              :text="String(group.failed)"
              prepend-icon="i-mdi:refresh"
              @click.stop="retryGroupFailures(group)"
            />
            <v-btn
              icon="i-mdi:delete-sweep"
              size="small"
              variant="text"
              :title="
                $formatMessage({
                  description: 'Downloads page: remove series',
                  defaultMessage: 'Remove series downloads',
                  id: 'wWii7g',
                })
              "
              @click.stop="requestRemoveGroup(group)"
            />
          </div>
        </template>
        <template #text>
          <v-row>
            <v-col
              v-for="download in group.downloads"
              :key="download.bookId"
              cols="12"
              md="6"
              xl="4"
            >
              <v-card
                variant="outlined"
                class="fill-height"
              >
                <div class="d-flex pa-3">
                  <v-img
                    :src="bookPosterUrl(download.bookId)"
                    width="82"
                    max-width="82"
                    height="116"
                    cover
                    class="me-4 rounded"
                  />
                  <div class="flex-grow-1 min-width-0">
                    <div class="text-subtitle-1 text-truncate">{{ download.book.seriesTitle }}</div>
                    <div class="text-body-2 text-truncate">
                      {{ download.book.metadata.number }} - {{ download.book.metadata.title }}
                    </div>

                    <div
                      v-if="download.status === 'downloading' || download.status === 'updating'"
                      class="mt-3"
                    >
                      <div class="d-flex text-caption mb-1">
                        <span>{{
                          download.status === 'updating'
                            ? $formatMessage({
                                description: 'Downloads page: updating',
                                defaultMessage: 'Updating',
                                id: 'zmI2mA',
                              })
                            : $formatMessage({
                                description: 'Downloads page: downloading',
                                defaultMessage: 'Downloading',
                                id: 'omwGFp',
                              })
                        }}</span>
                        <v-spacer />
                        <span>{{ download.completedPages }} / {{ download.totalPages }}</span>
                      </div>
                      <v-progress-linear
                        :model-value="
                          download.totalPages
                            ? (download.completedPages / download.totalPages) * 100
                            : 0
                        "
                        height="7"
                        rounded
                      />
                      <div class="text-caption text-medium-emphasis mt-1">
                        {{ formatBytes(download.bytes) }}
                        <template v-if="download.status === 'updating'">
                          ·
                          {{
                            $formatMessage({
                              description: 'Downloads page: old copy kept',
                              defaultMessage: 'old copy kept',
                              id: 'MV+lb3',
                            })
                          }}
                        </template>
                      </div>
                    </div>

                    <template v-else-if="download.status === 'downloaded'">
                      <v-chip
                        size="small"
                        color="success"
                        variant="outlined"
                        class="mt-3 me-2"
                        prepend-icon="i-mdi:check-circle"
                        :text="
                          $formatMessage({
                            description: 'Downloads page: available offline',
                            defaultMessage: 'Available offline',
                            id: 'ysmJwg',
                          }) +
                          ' · ' +
                          formatBytes(download.bytes)
                        "
                      />
                      <v-chip
                        v-if="download.updateAvailable"
                        size="small"
                        color="warning"
                        variant="outlined"
                        class="mt-3"
                        prepend-icon="i-mdi:update"
                        :text="
                          $formatMessage({
                            description: 'Downloads page: update available',
                            defaultMessage: 'Update available',
                            id: 'Mau++V',
                          })
                        "
                      />
                      <v-chip
                        v-if="download.sourceMissing"
                        size="small"
                        color="warning"
                        variant="outlined"
                        class="mt-3"
                        prepend-icon="i-mdi:cloud-off-outline"
                        :text="
                          $formatMessage({
                            description: 'Downloads page: source missing',
                            defaultMessage: 'No longer on server',
                            id: 'GIXwVC',
                          })
                        "
                      />
                      <v-alert
                        v-if="download.error"
                        type="warning"
                        variant="tonal"
                        density="compact"
                        class="mt-2 mb-0 text-caption"
                      >
                        {{
                          $formatMessage({
                            description: 'Downloads page: update failed kept',
                            defaultMessage: 'Update failed, old copy kept',
                            id: 'iRH/Rd',
                          })
                        }}: {{ download.error }}
                      </v-alert>
                    </template>

                    <v-chip
                      v-else-if="download.status === 'queued' || download.status === 'paused'"
                      size="small"
                      variant="outlined"
                      class="mt-3"
                      :prepend-icon="
                        download.status === 'paused' ? 'i-mdi:pause-circle' : 'i-mdi:clock-outline'
                      "
                      :text="
                        download.status === 'paused'
                          ? $formatMessage({
                              description: 'Downloads page: paused',
                              defaultMessage: 'Paused',
                              id: 'kZFfgo',
                            })
                          : $formatMessage({
                              description: 'Downloads page: queued',
                              defaultMessage: 'Queued',
                              id: 'kwSOft',
                            })
                      "
                    />

                    <v-alert
                      v-else-if="download.status === 'error'"
                      type="error"
                      variant="tonal"
                      density="compact"
                      class="mt-3 mb-0 text-caption"
                    >
                      {{
                        download.error ||
                        $formatMessage({
                          description: 'Downloads page: download failed',
                          defaultMessage: 'Download failed',
                          id: 'YcBSEL',
                        })
                      }}
                    </v-alert>
                  </div>
                </div>

                <v-divider />
                <v-card-actions>
                  <v-btn
                    v-if="download.cacheName"
                    :disabled="(offline.offlineMode || !offline.online) && isEpub(download.book)"
                    variant="text"
                    color="primary"
                    prepend-icon="i-mdi:book-open-page-variant"
                    :text="
                      $formatMessage({
                        description: 'Downloads page: read',
                        defaultMessage: 'Read',
                        id: '81DZaK',
                      })
                    "
                    @click="read(download)"
                  />
                  <v-btn
                    v-if="
                      download.updateAvailable &&
                      download.status === 'downloaded' &&
                      !download.sourceMissing
                    "
                    variant="text"
                    :disabled="!offline.online || offline.offlineMode"
                    prepend-icon="i-mdi:update"
                    :text="
                      $formatMessage({
                        description: 'Downloads page: update copy',
                        defaultMessage: 'Update',
                        id: 'Dx4ngf',
                      })
                    "
                    @click="retry(download.bookId)"
                  />
                  <v-btn
                    v-if="['queued', 'downloading', 'updating'].includes(download.status)"
                    variant="text"
                    prepend-icon="i-mdi:pause"
                    :text="
                      $formatMessage({
                        description: 'Downloads page: pause',
                        defaultMessage: 'Pause',
                        id: 'rIoYOY',
                      })
                    "
                    @click="pause(download.bookId)"
                  />
                  <v-btn
                    v-if="download.status === 'paused'"
                    variant="text"
                    :disabled="!offline.online || offline.offlineMode"
                    prepend-icon="i-mdi:play"
                    :text="
                      $formatMessage({
                        description: 'Downloads page: resume',
                        defaultMessage: 'Resume',
                        id: 'kUl3uu',
                      })
                    "
                    @click="resume(download.bookId)"
                  />
                  <v-btn
                    v-if="download.status === 'error'"
                    variant="text"
                    :disabled="!offline.online || offline.offlineMode"
                    prepend-icon="i-mdi:refresh"
                    :text="
                      $formatMessage({
                        description: 'Downloads page: retry',
                        defaultMessage: 'Retry',
                        id: 'qQQ+Xd',
                      })
                    "
                    @click="retry(download.bookId)"
                  />
                  <v-spacer />
                  <v-btn
                    icon="i-mdi:delete"
                    :title="
                      $formatMessage({
                        description: 'Downloads page: remove download',
                        defaultMessage: 'Remove download',
                        id: 'zzd9xD',
                      })
                    "
                    @click="requestRemove(download)"
                  />
                </v-card-actions>
              </v-card>
            </v-col>
          </v-row>
        </template>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card
      v-else
      variant="outlined"
      class="pa-8 text-center"
    >
      <v-icon
        size="56"
        class="mb-3"
        icon="i-mdi:download-off-outline"
      />
      <div class="text-h6">
        {{
          $formatMessage({
            description: 'Downloads page: no downloads',
            defaultMessage: 'No offline books yet',
            id: 'jM/9dD',
          })
        }}
      </div>
      <div class="text-body-2 text-medium-emphasis mt-1">
        {{
          $formatMessage({
            description: 'Downloads page: no downloads description',
            defaultMessage: 'Use a book or series menu to save titles for offline reading.',
            id: 'w7CxFg',
          })
        }}
      </div>
    </v-card>

    <v-dialog
      v-model="confirmingRemoval"
      max-width="500"
    >
      <v-card>
        <v-card-title>
          {{
            $formatMessage({
              description: 'Downloads page: confirm remove title',
              defaultMessage: 'Remove offline content?',
              id: '7helmM',
            })
          }}
        </v-card-title>
        <v-card-text>{{ removalText }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :text="
              $formatMessage({
                description: 'Downloads page: cancel',
                defaultMessage: 'Cancel',
                id: '3q5mKl',
              })
            "
            @click="confirmingRemoval = false"
          />
          <v-btn
            variant="flat"
            color="error"
            :text="
              $formatMessage({
                description: 'Downloads page: confirm remove',
                defaultMessage: 'Remove',
                id: 'RdPrIL',
              })
            "
            @click="confirmRemove"
          />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { prepareOfflineShell } from '@/services/offline-shell'
import { useIntl } from 'vue-intl'
import { bookPosterUrl } from '@/api/images'
import { bookReaderUrl } from '@/api/links'
import {
  formatBytes,
  groupDownloadsBySeries,
  type DownloadGroup,
} from '@/offline/offline-downloads'
import { useOfflineLibraryStore } from '@/offline'
import type { OfflineDownloadRecord } from '@/offline'

const intl = useIntl()
const offline = useOfflineLibraryStore()

const changingMode = ref(false)
const notificationPermission = ref(
  typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
)
const confirmingRemoval = ref(false)
const pendingRemoval = ref<OfflineDownloadRecord[]>([])
const storage = ref({ usage: 0, quota: 0 })

const downloads = computed(() => offline.downloads)
const groups = computed<DownloadGroup[]>(() => groupDownloadsBySeries(downloads.value))

const notificationsEnabled = computed(
  () => offline.preferences.notifyWhenComplete && notificationPermission.value === 'granted',
)
const notificationHint = computed(() => {
  if (notificationPermission.value === 'unsupported')
    return intl.formatMessage({
      description: 'Downloads page: notifications unsupported',
      defaultMessage: 'Notifications are not supported in this browser',
      id: 'NUSK+b',
    })
  if (notificationPermission.value === 'denied')
    return intl.formatMessage({
      description: 'Downloads page: notifications denied',
      defaultMessage: 'Notifications are blocked. Enable them in the browser settings.',
      id: 'yBuCo8',
    })
  return intl.formatMessage(
    notificationPermission.value === 'granted'
      ? {
          description: 'Downloads page: notifications enabled',
          defaultMessage: 'Notifications will be shown when downloads finish',
          id: 'rgZgwH',
        }
      : {
          description: 'Downloads page: notifications hint',
          defaultMessage: 'Allow notifications to get informed when downloads finish',
          id: 'HViSmI',
        },
  )
})

const removalText = computed(() => {
  if (pendingRemoval.value.length === 0) return ''
  if (pendingRemoval.value.length === 1)
    return intl.formatMessage(
      {
        description: 'Downloads page: confirm remove book',
        defaultMessage: 'Remove offline copy of {title}?',
        id: 'vWALrR',
      },
      { title: pendingRemoval.value[0]?.book.metadata.title },
    )
  return intl.formatMessage(
    {
      description: 'Downloads page: confirm remove series',
      defaultMessage: 'Remove {count} offline books from {title}?',
      id: 'UBdoAo',
    },
    {
      title: pendingRemoval.value[0]?.book.seriesTitle,
      count: pendingRemoval.value.length,
    },
  )
})

const storagePercent = computed(() => {
  if (!storage.value.quota) return 0
  return Math.min(100, (storage.value.usage / storage.value.quota) * 100)
})
const storageHeadroom = computed(() => Math.max(0, storage.value.quota - storage.value.usage))
const catalogStatusText = computed(() => {
  if (offline.syncingMetadata)
    return intl.formatMessage(
      {
        defaultMessage: 'Saving catalog: {done} of {total} entries in this batch',
        id: '57AL+B',
        description: 'Downloads catalog sync progress',
      },
      { done: offline.catalogProgress?.done ?? 0, total: offline.catalogProgress?.total ?? 0 },
    )
  if (offline.catalogSyncedAt)
    return intl.formatMessage(
      {
        defaultMessage: 'Full catalog saved on this device. Last synced {date}.',
        id: 'u8EmZl',
        description: 'Downloads catalog ready',
      },
      { date: new Date(offline.catalogSyncedAt).toLocaleString() },
    )
  return intl.formatMessage({
    defaultMessage:
      'Full catalog has not been saved yet. Stay online and sync it for offline browsing.',
    id: 'QJFkAI',
    description: 'Downloads catalog not ready',
  })
})
async function syncCatalog() {
  await offline.syncCatalogMetadata().catch(() => undefined)
}

const shellStatusText = computed(() => {
  if (offline.shellReady === 'ready')
    return intl.formatMessage({
      description: 'Downloads page: offline shell ready',
      defaultMessage: 'Offline app shell is ready',
      id: '7cqTpL',
    })
  if (offline.shellReady === 'incomplete')
    return intl.formatMessage({
      defaultMessage:
        'Offline setup is incomplete. Stay connected and retry before closing the app.',
      id: 'A54yH6',
      description: 'Downloads incomplete offline setup',
    })
  const precache = offline.shellPrecache
  return intl.formatMessage(
    {
      description: 'Downloads page: offline shell preparing',
      defaultMessage: 'Preparing offline app shell: {done} of {expected}',
      id: '4GWZ2Y',
    },
    { done: precache?.done ?? 0, expected: precache?.expected ?? 0 },
  )
})
const storageText = computed(() => {
  if (!storage.value.quota)
    return intl.formatMessage({
      description: 'Downloads page: storage unavailable',
      defaultMessage: 'Storage estimate is unavailable in this browser',
      id: 'IwXRPg',
    })
  return intl.formatMessage(
    {
      description: 'Downloads page: storage used',
      defaultMessage: '{usage} used',
      id: 'vVxJX1',
    },
    { usage: formatBytes(storage.value.usage) },
  )
})

onMounted(async () => {
  await offline.whenReady()
  await refreshStorage()
})

async function refreshStorage() {
  storage.value = await offline.storageEstimate()
}

async function changeOfflineMode(enabled: boolean | null) {
  if (typeof enabled !== 'boolean') return
  changingMode.value = true
  try {
    await offline.setOfflineMode(enabled)
  } finally {
    changingMode.value = false
  }
}

function requestRemove(download: OfflineDownloadRecord) {
  pendingRemoval.value = [download]
  confirmingRemoval.value = true
}

function requestRemoveGroup(group: DownloadGroup) {
  pendingRemoval.value = [...group.downloads]
  confirmingRemoval.value = true
}

async function confirmRemove() {
  const removals = [...pendingRemoval.value]
  pendingRemoval.value = []
  confirmingRemoval.value = false
  await Promise.all(removals.map((item) => offline.removeDownload(item.bookId)))
  await refreshStorage()
}

async function retry(bookId: string) {
  await offline.downloadBook(bookId)
  await refreshStorage()
}

async function retryGroupFailures(group: DownloadGroup) {
  const failed = group.downloads
    .filter((item) => item.status === 'error' || !!item.error)
    .map((item) => item.book)
  await offline.downloadBooks(failed, group.seriesId)
  await refreshStorage()
}

async function pause(bookId: string) {
  await offline.pauseDownload(bookId)
}

async function resume(bookId: string) {
  await offline.resumeDownload(bookId)
}

async function setPreference(key: string, value: unknown) {
  await offline.setDownloadPreferences({ [key]: value })
}

async function toggleNotifications(enabled: boolean | null) {
  let next = enabled === true
  if (next) {
    if (typeof Notification === 'undefined') next = false
    else if (Notification.permission !== 'granted')
      next = (await Notification.requestPermission()) === 'granted'
  }
  await setPreference('notifyWhenComplete', next)
  notificationPermission.value =
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
}

function isEpub(book: OfflineDownloadRecord['book']): boolean {
  const profile = (book.media?.mediaProfile ?? '').toLowerCase()
  return profile === 'epub' && !book.media?.epubDivinaCompatible
}

function read(download: OfflineDownloadRecord) {
  offline.readerOpened(download.bookId)
  window.open(bookReaderUrl(download.bookId, isEpub(download.book)), '_self')
}
</script>

<style scoped>
.min-width-0 {
  min-width: 0;
}
</style>

<route lang="yaml">
meta:
  requiresRole: USER
</route>
