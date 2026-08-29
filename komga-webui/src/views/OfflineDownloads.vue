<template>
  <v-container fluid class="pa-4 pa-sm-6">
    <v-row align="center">
      <v-col>
        <div class="text-h5">{{ $t('offline.downloads') }}</div>
        <div class="text-caption text--secondary">{{ $t('offline.downloads_subtitle') }}</div>
      </v-col>
      <v-col cols="auto">
        <v-switch
          :input-value="$offline.state.offlineMode"
          :label="$t('offline.offline_mode')"
          :loading="changingMode"
          hide-details
          class="mt-0"
          @change="changeOfflineMode"
        />
      </v-col>
    </v-row>

    <v-alert
      v-if="$offline.state.offlineMode"
      type="info"
      text
      dense
      class="mt-4"
    >
      {{ $t('offline.offline_mode_description') }}
    </v-alert>

    <v-alert
      :type="offlineLaunchReady ? 'success' : 'warning'"
      text
      dense
      class="mt-4"
    >
      <div class="font-weight-medium">
        {{ $t(offlineLaunchReady ? 'offline.offline_launch_ready' : 'offline.offline_launch_not_ready') }}
      </div>
      <div class="text-caption mt-1">
        {{ $t(offlineLaunchReady ? 'offline.offline_launch_ready_description' : 'offline.offline_launch_not_ready_description') }}
      </div>
      <div v-if="offlineLaunch.active" class="text-caption mt-1">
        {{ $t('offline.offline_worker_details', {
          version: offlineLaunch.version || 'unknown',
          controlled: offlineLaunch.controlled ? 'yes' : 'no'
        }) }}
      </div>
      <v-btn
        v-if="!offlineLaunchReady && $offline.state.online"
        small
        text
        class="mt-2"
        :loading="preparingLaunch"
        @click="prepareOfflineLaunch"
      >
        <v-icon left small>mdi-cloud-download-outline</v-icon>
        {{ $t('offline.prepare_offline_launch') }}
      </v-btn>
    </v-alert>

    <v-card outlined class="my-4">
      <v-card-text>
        <div class="d-flex align-center mb-2">
          <v-icon class="me-2">mdi-database</v-icon>
          <strong>{{ $t('offline.storage') }}</strong>
          <v-spacer/>
          <span class="text-caption">{{ storageText }}</span>
        </div>
        <v-progress-linear
          v-if="storage.quota > 0"
          :value="storagePercent"
          height="8"
          rounded
        />
        <div v-if="storage.quota > 0" class="text-caption text--secondary mt-2">
          {{ $t('offline.browser_quota', {quota: formatBytes(storage.quota)}) }}
          ·
          {{ $t('offline.browser_headroom', {available: formatBytes(storageHeadroom)}) }}
        </div>
        <div class="text-caption text--secondary mt-1">
          {{ $t('offline.catalog_cached', {books: $offline.state.cachedBooks, series: $offline.state.cachedSeries}) }}
        </div>
        <v-alert
          v-if="storage.quota > 0"
          type="warning"
          text
          dense
          class="mt-3 mb-0 text-caption"
        >
          {{ $t('offline.device_storage_warning') }}
        </v-alert>
      </v-card-text>
    </v-card>

    <v-row v-if="downloads.length > 0">
      <v-col
        v-for="download in downloads"
        :key="download.bookId"
        cols="12"
        md="6"
        xl="4"
      >
        <v-card outlined class="fill-height">
          <div class="d-flex pa-3">
            <v-img
              :src="thumbnail(download.bookId)"
              width="82"
              max-width="82"
              height="116"
              contain
              class="me-4 rounded"
            />
            <div class="flex-grow-1 min-width-0">
              <div class="text-subtitle-1 text-truncate">{{ download.book.seriesTitle }}</div>
              <div class="text-body-2 text-truncate">
                {{ download.book.metadata.number }} - {{ download.book.metadata.title }}
              </div>

              <div v-if="download.status === 'downloading' || download.status === 'updating'" class="mt-3">
                <div class="d-flex text-caption mb-1">
                  <span>{{ $t(download.status === 'updating' ? 'offline.updating' : 'offline.downloading') }}</span>
                  <v-spacer/>
                  <span>{{ download.completedPages }} / {{ download.totalPages }}</span>
                </div>
                <v-progress-linear
                  :value="download.totalPages ? download.completedPages / download.totalPages * 100 : 0"
                  height="7"
                  rounded
                />
                <div class="text-caption text--secondary mt-1">
                  {{ formatBytes(download.bytes) }}
                  <template v-if="download.status === 'updating'"> · {{ $t('offline.old_copy_kept') }}</template>
                </div>
              </div>

              <template v-else-if="download.status === 'downloaded'">
                <v-chip
                  small
                  color="success"
                  outlined
                  class="mt-3 me-2"
                >
                  <v-icon left small>mdi-check-circle</v-icon>
                  {{ $t('offline.available_offline') }} · {{ formatBytes(download.bytes) }}
                </v-chip>
                <v-chip
                  v-if="download.updateAvailable"
                  small
                  color="warning"
                  outlined
                  class="mt-3"
                >
                  <v-icon left small>mdi-update</v-icon>
                  {{ $t('offline.update_available') }}
                </v-chip>
                <v-chip
                  v-if="download.sourceMissing"
                  small
                  color="warning"
                  outlined
                  class="mt-3"
                >
                  <v-icon left small>mdi-cloud-off-outline</v-icon>
                  {{ $t('offline.source_missing') }}
                </v-chip>
                <v-alert
                  v-if="download.error"
                  type="warning"
                  dense
                  text
                  class="mt-2 mb-0 text-caption"
                >{{ $t('offline.update_failed_kept') }}: {{ download.error }}</v-alert>
              </template>

              <v-alert
                v-else
                type="error"
                dense
                text
                class="mt-3 mb-0 text-caption"
              >{{ download.error || $t('offline.download_failed') }}</v-alert>
            </div>
          </div>

          <v-divider/>
          <v-card-actions>
            <v-btn
              v-if="download.cacheName"
              text
              color="accent"
              @click="read(download)"
            >
              <v-icon left>mdi-book-open-page-variant</v-icon>
              {{ $t('common.read') }}
            </v-btn>
            <v-btn
              v-if="download.updateAvailable && download.status === 'downloaded' && !download.sourceMissing"
              text
              :disabled="!$offline.state.online || $offline.state.offlineMode"
              @click="retry(download.bookId)"
            >
              <v-icon left>mdi-update</v-icon>
              {{ $t('offline.update_copy') }}
            </v-btn>
            <v-btn
              v-if="download.status === 'error'"
              text
              :disabled="!$offline.state.online || $offline.state.offlineMode"
              @click="retry(download.bookId)"
            >
              <v-icon left>mdi-refresh</v-icon>
              {{ $t('offline.retry_download') }}
            </v-btn>
            <v-spacer/>
            <v-btn
              icon
              :title="$t('offline.remove_download')"
              :disabled="download.status === 'downloading' || download.status === 'updating'"
              @click="remove(download.bookId)"
            >
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-card v-else outlined class="pa-8 text-center">
      <v-icon size="56" class="mb-3">mdi-download-off-outline</v-icon>
      <div class="text-h6">{{ $t('offline.no_downloads') }}</div>
      <div class="text-body-2 text--secondary mt-1">{{ $t('offline.no_downloads_description') }}</div>
    </v-card>
  </v-container>
</template>

<script lang="ts">
import Vue from 'vue'
import {OfflineDownloadRecord} from '@/services/offline-library.service'
import {bookThumbnailUrl} from '@/functions/urls'
import {getBookReadRouteFromMedia} from '@/functions/book-format'

interface OfflineLaunchState {
  supported: boolean
  registered: boolean
  active: boolean
  controlled: boolean
  shellReady: boolean
  version: string
}

export default Vue.extend({
  name: 'OfflineDownloads',
  data: () => ({
    changingMode: false,
    preparingLaunch: false,
    storage: {usage: 0, quota: 0},
    offlineLaunch: {
      supported: 'serviceWorker' in navigator,
      registered: false,
      active: false,
      controlled: false,
      shellReady: false,
      version: '',
    } as OfflineLaunchState,
  }),
  computed: {
    downloads(): OfflineDownloadRecord[] {
      return this.$offline.state.downloads
    },
    offlineLaunchReady(): boolean {
      return this.offlineLaunch.supported && this.offlineLaunch.registered &&
        this.offlineLaunch.active && this.offlineLaunch.shellReady
    },
    storagePercent(): number {
      if (!this.storage.quota) return 0
      return Math.min(100, this.storage.usage / this.storage.quota * 100)
    },
    storageHeadroom(): number {
      return Math.max(0, this.storage.quota - this.storage.usage)
    },
    storageText(): string {
      if (!this.storage.quota) return this.$t('offline.storage_unavailable').toString()
      return this.$t('offline.storage_used', {usage: this.formatBytes(this.storage.usage)}).toString()
    },
  },
  async created() {
    await this.$offline.whenReady()
    await this.refreshStorage()
    if (this.$offline.state.online) await this.prepareOfflineLaunch()
    else await this.refreshOfflineLaunchStatus()
  },
  methods: {
    thumbnail(bookId: string): string {
      return bookThumbnailUrl(bookId)
    },
    formatBytes(bytes: number): string {
      if (!bytes) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
      const value = bytes / Math.pow(1024, index)
      return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
    },
    shellAssets(): string[] {
      const assets = new Set<string>()
      document.querySelectorAll<HTMLScriptElement>('script[src]').forEach(element => assets.add(element.src))
      document.querySelectorAll<HTMLLinkElement>('link[href]').forEach(element => {
        const rel = element.rel.toLocaleLowerCase()
        if (['stylesheet', 'icon', 'apple-touch-icon', 'manifest', 'preload', 'modulepreload'].includes(rel)) {
          assets.add(element.href)
        }
      })
      return Array.from(assets)
    },
    workerStatus(worker: ServiceWorker): Promise<any> {
      return new Promise(resolve => {
        const channel = new MessageChannel()
        const timer = window.setTimeout(() => resolve(undefined), 1500)
        channel.port1.onmessage = event => {
          window.clearTimeout(timer)
          resolve(event.data)
        }
        worker.postMessage({type: 'KOMGA_OFFLINE_STATUS'}, [channel.port2])
      })
    },
    async refreshOfflineLaunchStatus() {
      if (!('serviceWorker' in navigator)) {
        this.offlineLaunch = {...this.offlineLaunch, supported: false}
        return
      }

      const registration = await navigator.serviceWorker.getRegistration()
      const active = registration?.active
      let status: any
      if (active) status = await this.workerStatus(active)
      this.offlineLaunch = {
        supported: true,
        registered: !!registration,
        active: !!active,
        controlled: !!navigator.serviceWorker.controller,
        shellReady: status?.shellReady === true,
        version: status?.version || '',
      }
    },
    async prepareOfflineLaunch() {
      if (!('serviceWorker' in navigator) || !this.$offline.state.online) {
        await this.refreshOfflineLaunchStatus()
        return
      }
      this.preparingLaunch = true
      try {
        const registration = await navigator.serviceWorker.ready
        try {
          await registration.update()
        } catch (_) {
          // The currently active worker can still prepare the shell.
        }
        const worker = registration.active
        if (worker) {
          worker.postMessage({
            type: 'KOMGA_PREPARE_OFFLINE_SHELL',
            pageUrl: window.location.href,
            assets: this.shellAssets(),
          })
          await new Promise(resolve => window.setTimeout(resolve, 800))
        }
        await this.refreshOfflineLaunchStatus()
      } finally {
        this.preparingLaunch = false
      }
    },
    async refreshStorage() {
      this.storage = await this.$offline.storageEstimate()
    },
    async changeOfflineMode(enabled: boolean) {
      this.changingMode = true
      try {
        await this.$offline.setOfflineMode(enabled)
      } finally {
        this.changingMode = false
      }
    },
    async remove(bookId: string) {
      await this.$offline.removeDownload(bookId)
      await this.refreshStorage()
    },
    async retry(bookId: string) {
      await this.$offline.downloadBook(bookId)
      await this.refreshStorage()
    },
    read(download: OfflineDownloadRecord) {
      this.$router.push({
        name: getBookReadRouteFromMedia(download.book.media),
        params: {bookId: download.bookId},
      })
    },
  },
})
</script>

<style scoped>
.min-width-0 {
  min-width: 0;
}
</style>