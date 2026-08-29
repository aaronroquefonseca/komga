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
        <div class="text-caption text--secondary mt-2">
          {{ $t('offline.catalog_cached', {books: $offline.state.cachedBooks, series: $offline.state.cachedSeries}) }}
        </div>
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

              <div v-if="download.status === 'downloading'" class="mt-3">
                <div class="d-flex text-caption mb-1">
                  <span>{{ $t('offline.downloading') }}</span>
                  <v-spacer/>
                  <span>{{ download.completedPages }} / {{ download.totalPages }}</span>
                </div>
                <v-progress-linear
                  :value="download.totalPages ? download.completedPages / download.totalPages * 100 : 0"
                  height="7"
                  rounded
                />
                <div class="text-caption text--secondary mt-1">{{ formatBytes(download.bytes) }}</div>
              </div>

              <v-chip
                v-else-if="download.status === 'downloaded'"
                small
                color="success"
                outlined
                class="mt-3"
              >
                <v-icon left small>mdi-check-circle</v-icon>
                {{ $t('offline.available_offline') }} · {{ formatBytes(download.bytes) }}
              </v-chip>

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
              v-if="download.status === 'downloaded'"
              text
              color="accent"
              @click="read(download)"
            >
              <v-icon left>mdi-book-open-page-variant</v-icon>
              {{ $t('common.read') }}
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
              :disabled="download.status === 'downloading'"
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

export default Vue.extend({
  name: 'OfflineDownloads',
  data: () => ({
    changingMode: false,
    storage: {usage: 0, quota: 0},
  }),
  computed: {
    downloads(): OfflineDownloadRecord[] {
      return this.$offline.state.downloads
    },
    storagePercent(): number {
      if (!this.storage.quota) return 0
      return Math.min(100, this.storage.usage / this.storage.quota * 100)
    },
    storageText(): string {
      if (!this.storage.quota) return this.$t('offline.storage_unavailable').toString()
      return `${this.formatBytes(this.storage.usage)} / ${this.formatBytes(this.storage.quota)}`
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