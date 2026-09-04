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

    <v-card outlined class="my-4">
      <v-card-title class="text-subtitle-1">{{ $t('offline.download_settings') }}</v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" sm="6"><v-select :value="$offline.state.preferences.concurrentBooks" :items="[1, 2, 3, 4, 6]" :label="$t('offline.parallel_books')" hide-details @change="setPreference('concurrentBooks', $event)"/></v-col>
          <v-col cols="12" sm="6"><v-select :value="$offline.state.preferences.concurrentPages" :items="[1, 2, 3, 4]" :label="$t('offline.parallel_pages')" hide-details @change="setPreference('concurrentPages', $event)"/></v-col>
        </v-row>
        <v-switch :input-value="notificationsEnabled" :label="$t('offline.progress_notifications')" :hint="notificationHint" persistent-hint @change="toggleNotifications"/>
        <v-switch :input-value="$offline.state.preferences.removeRead" :label="$t('offline.remove_read_automatically')" hide-details @change="setPreference('removeRead', $event)"/>
        <v-switch :input-value="$offline.state.preferences.autoDownloadNext" :label="$t('offline.auto_download_next')" :hint="$t('offline.smart_download_hint')" persistent-hint @change="setPreference('autoDownloadNext', $event)"/>
      </v-card-text>
    </v-card>

    <v-expansion-panels v-if="downloads.length > 0" multiple accordion>
      <v-expansion-panel v-for="group in downloadGroups" :key="group.seriesId">
        <v-expansion-panel-header>
          <div class="d-flex align-center flex-grow-1 me-3">
            <div><div class="font-weight-medium">{{ group.title }}</div><div class="text-caption text--secondary">{{ $t('offline.series_download_summary', {downloaded: group.downloaded, total: group.downloads.length, bytes: formatBytes(group.bytes)}) }}</div></div>
            <v-spacer/>
            <v-btn v-if="group.failed" small text color="warning" :title="$t('offline.retry_series_failed', {count: group.failed})" @click.stop="retryGroupFailures(group)"><v-icon left>mdi-refresh</v-icon>{{ group.failed }}</v-btn>
            <v-btn icon small :title="$t('offline.remove_series_downloads')" @click.stop="requestRemoveGroup(group)"><v-icon>mdi-delete-sweep</v-icon></v-btn>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content><v-row>
      <v-col v-for="download in group.downloads" :key="download.bookId" cols="12" md="6" xl="4">
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

              <v-chip v-else-if="download.status === 'queued' || download.status === 'paused'" small outlined class="mt-3">
                <v-icon left small>{{ download.status === 'paused' ? 'mdi-pause-circle' : 'mdi-clock-outline' }}</v-icon>
                {{ $t(`offline.${download.status}`) }}
              </v-chip>

              <v-alert
                v-else-if="download.status === 'error'"
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
              v-if="['queued', 'downloading', 'updating'].includes(download.status)"
              text
              @click="pause(download.bookId)"
            ><v-icon left>mdi-pause</v-icon>{{ $t('offline.pause_download') }}</v-btn>
            <v-btn
              v-if="download.status === 'paused'"
              text
              :disabled="!$offline.state.online || $offline.state.offlineMode"
              @click="resume(download.bookId)"
            ><v-icon left>mdi-play</v-icon>{{ $t('offline.resume_download') }}</v-btn>
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
              @click="requestRemove(download)"
            >
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
        </v-row></v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card v-else outlined class="pa-8 text-center">
      <v-icon size="56" class="mb-3">mdi-download-off-outline</v-icon>
      <div class="text-h6">{{ $t('offline.no_downloads') }}</div>
      <div class="text-body-2 text--secondary mt-1">{{ $t('offline.no_downloads_description') }}</div>
    </v-card>
    <confirmation-dialog
      v-model="confirmingRemoval"
      :title="$t('offline.confirm_remove_title')"
      :body="removalText"
      :button-confirm="$t('offline.confirm_remove_button')"
      button-confirm-color="error"
      @confirm="confirmRemove"
    />
  </v-container>
</template>

<script lang="ts">
import Vue from 'vue'
import {OfflineDownloadRecord} from '@/services/offline-library.service'
import {bookThumbnailUrl} from '@/functions/urls'
import {getBookReadRouteFromMedia} from '@/functions/book-format'
import ConfirmationDialog from '@/components/dialogs/ConfirmationDialog.vue'

interface DownloadGroup {
  seriesId: string
  title: string
  downloads: OfflineDownloadRecord[]
  downloaded: number
  failed: number
  bytes: number
}

export default Vue.extend({
  name: 'OfflineDownloads',
  components: {ConfirmationDialog},
  data: () => ({
    changingMode: false,
    notificationPermission: 'Notification' in window ? Notification.permission : 'unsupported',
    confirmingRemoval: false,
    pendingRemoval: [] as OfflineDownloadRecord[],
    storage: {usage: 0, quota: 0},
  }),
  computed: {
    notificationsEnabled(): boolean {
      return this.$offline.state.preferences.notifyWhenComplete && this.notificationPermission === 'granted'
    },
    notificationHint(): string {
      if (this.notificationPermission === 'unsupported') return this.$t('offline.notification_unsupported').toString()
      if (this.notificationPermission === 'denied') return this.$t('offline.notification_denied').toString()
      return this.$t(this.notificationPermission === 'granted' ? 'offline.notification_enabled' : 'offline.notification_enable_hint').toString()
    },
    downloads(): OfflineDownloadRecord[] {
      return this.$offline.state.downloads
    },
    downloadGroups(): DownloadGroup[] {
      const grouped = new Map<string, OfflineDownloadRecord[]>()
      this.downloads.forEach(item => grouped.set(item.book.seriesId, [...(grouped.get(item.book.seriesId) || []), item]))
      return Array.from(grouped.entries()).map(([seriesId, downloads]) => ({
        seriesId,
        title: downloads[0].book.seriesTitle,
        downloads: downloads.sort((a, b) => (a.book.metadata.numberSort || 0) - (b.book.metadata.numberSort || 0)),
        downloaded: downloads.filter(item => item.status === 'downloaded').length,
        failed: downloads.filter(item => item.status === 'error' || !!item.error).length,
        bytes: downloads.reduce((sum, item) => sum + item.bytes, 0),
      }))
    },
    removalText(): string {
      if (this.pendingRemoval.length === 0) return ''
      if (this.pendingRemoval.length === 1) return this.$t('offline.confirm_remove_book', {title: this.pendingRemoval[0].book.metadata.title}).toString()
      return this.$t('offline.confirm_remove_series', {title: this.pendingRemoval[0].book.seriesTitle, count: this.pendingRemoval.length}).toString()
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
    requestRemove(download: OfflineDownloadRecord) {
      this.pendingRemoval = [download]
      this.confirmingRemoval = true
    },
    requestRemoveGroup(group: DownloadGroup) {
      this.pendingRemoval = [...group.downloads]
      this.confirmingRemoval = true
    },
    async confirmRemove() {
      const removals = [...this.pendingRemoval]
      this.pendingRemoval = []
      await Promise.all(removals.map(item => this.$offline.removeDownload(item.bookId)))
      await this.refreshStorage()
    },
    async retry(bookId: string) {
      await this.$offline.downloadBook(bookId)
      await this.refreshStorage()
    },
    async retryGroupFailures(group: DownloadGroup) {
      const failed = group.downloads.filter(item => item.status === 'error' || !!item.error).map(item => item.book)
      await this.$offline.downloadBooks(failed, group.seriesId)
      await this.refreshStorage()
    },
    async pause(bookId: string) {
      await this.$offline.pauseDownload(bookId)
    },
    async resume(bookId: string) {
      await this.$offline.resumeDownload(bookId)
    },
    async setPreference(key: string, value: any) {
      await this.$offline.setDownloadPreferences({[key]: value})
    },
    async toggleNotifications(enabled: boolean) {
      if (enabled) {
        if (!('Notification' in window)) enabled = false
        else if (Notification.permission !== 'granted') enabled = (await Notification.requestPermission()) === 'granted'
      }
      await this.setPreference('notifyWhenComplete', enabled)
      this.notificationPermission = 'Notification' in window ? Notification.permission : 'unsupported'
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
