<template>
  <div>
    <v-menu offset-y v-model="menuState">
      <template v-slot:activator="{ on }">
        <v-btn icon v-on="on" @click.prevent="">
          <v-icon>mdi-dots-vertical</v-icon>
        </v-btn>
      </template>
      <v-list dense>
        <template v-if="isPwa">
          <v-list-item v-if="seriesDownloading" disabled>
            <v-list-item-icon><v-icon small>mdi-download</v-icon></v-list-item-icon>
            <v-list-item-title>
              {{ $t('offline.downloading_series', {downloaded: downloadedBookCount, total: series.booksCount}) }}
            </v-list-item-title>
          </v-list-item>
          <v-list-item
            v-else-if="!seriesAllDownloaded || seriesNeedsUpdate"
            :disabled="!$offline.state.online || $offline.state.offlineMode"
            @click="downloadSeries"
          >
            <v-list-item-icon><v-icon small>{{ seriesNeedsUpdate ? 'mdi-update' : 'mdi-download-multiple' }}</v-icon></v-list-item-icon>
            <v-list-item-title v-if="seriesAllDownloaded && seriesNeedsUpdate">
              {{ $t('offline.update_series_offline') }}
            </v-list-item-title>
            <v-list-item-title v-else-if="downloadedBookCount === 0">
              {{ $t('offline.save_series_offline') }}
            </v-list-item-title>
            <v-list-item-title v-else>
              {{ $t('offline.download_series_remaining', {downloaded: downloadedBookCount, total: series.booksCount}) }}
            </v-list-item-title>
          </v-list-item>
          <v-list-item v-if="downloadedBookCount > 0 && !seriesDownloading" @click="removeSeriesDownloads">
            <v-list-item-icon><v-icon small>mdi-download-off</v-icon></v-list-item-icon>
            <v-list-item-title>{{ $t('offline.remove_series_downloads') }}</v-list-item-title>
          </v-list-item>
          <v-list-item :to="{name: 'offline-downloads'}">
            <v-list-item-icon><v-icon small>mdi-download-box-multiple</v-icon></v-list-item-icon>
            <v-list-item-title>{{ $t('offline.manage_downloads') }}</v-list-item-title>
          </v-list-item>
          <v-divider/>
        </template>

        <v-list-item @click="analyze" v-if="isAdmin">
          <v-list-item-title>{{ $t('menu.analyze') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="refreshMetadata" v-if="isAdmin">
          <v-list-item-title>{{ $t('menu.refresh_metadata') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="addToCollection" v-if="isAdmin">
          <v-list-item-title>{{ $t('menu.add_to_collection') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="addToReadList" v-if="isAdmin">
          <v-list-item-title>{{ $t('menu.add_to_readlist') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="markRead" v-if="!isRead">
          <v-list-item-title>{{ $t('menu.mark_read') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="markUnread" v-if="!isUnread">
          <v-list-item-title>{{ $t('menu.mark_unread') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="promptDeleteSeries" class="list-danger" v-if="isAdmin">
          <v-list-item-title>{{ $t('menu.delete') }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>
<script lang="ts">
import Vue from 'vue'
import {SeriesDto} from '@/types/komga-series'
import {BookDto} from '@/types/komga-books'
import {BookSearch, SearchConditionSeriesId, SearchOperatorIs} from '@/types/komga-search'
import {ERROR} from '@/types/events'
import {isStandalonePwa} from '@/functions/pwa'

const STORAGE_RESERVE_BYTES = 64 * 1024 * 1024
const DOWNLOAD_SIZE_MARGIN = 1.25

export default Vue.extend({
  name: 'SeriesActionsMenu',
  data: () => ({
    menuState: false,
    seriesDownloading: false,
  }),
  props: {
    series: {
      type: Object as () => SeriesDto,
      required: true,
    },
    menu: {
      type: Boolean,
      default: false,
    },
  },
  watch: {
    menuState(val) {
      this.$emit('update:menu', val)
    },
  },
  computed: {
    isPwa(): boolean {
      return isStandalonePwa()
    },
    isAdmin(): boolean {
      return this.$store.getters.meAdmin
    },
    isRead(): boolean {
      return this.series.booksReadCount === this.series.booksCount
    },
    isUnread(): boolean {
      return this.series.booksUnreadCount === this.series.booksCount
    },
    downloadedBookCount(): number {
      return this.$offline.state.downloads
        .filter(record => record.book?.seriesId === this.series.id && this.$offline.isDownloaded(record.bookId))
        .length
    },
    seriesAllDownloaded(): boolean {
      return this.series.booksCount > 0 && this.downloadedBookCount >= this.series.booksCount
    },
    seriesNeedsUpdate(): boolean {
      return this.$offline.state.downloads
        .some(record => record.book?.seriesId === this.series.id && record.updateAvailable === true && !record.sourceMissing)
    },
  },
  methods: {
    analyze() {
      this.$komgaSeries.analyzeSeries(this.series)
    },
    refreshMetadata() {
      this.$komgaSeries.refreshMetadata(this.series)
    },
    addToCollection() {
      this.$store.dispatch('dialogAddSeriesToCollection', [this.series.id])
    },
    async addToReadList() {
      const books = await this.$komgaBooks.getBooksList({
        condition: new SearchConditionSeriesId(new SearchOperatorIs(this.series.id)),
      } as BookSearch, {unpaged: true, sort: ['metadata.numberSort']})
      this.$store.dispatch('dialogAddBooksToReadList', books.content.map(b => b.id))
    },
    formatBytes(bytes: number): string {
      if (!bytes) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
      const value = bytes / Math.pow(1024, index)
      return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
    },
    requiredSeriesBytes(books: BookDto[]): number {
      let missingBytes = 0
      let largestUpdateBytes = 0

      books.forEach(book => {
        const existing = this.$offline.getDownload(book.id)
        if (!this.$offline.isDownloaded(book.id)) {
          missingBytes += book.sizeBytes || 0
        } else if (existing?.updateAvailable) {
          largestUpdateBytes = Math.max(largestUpdateBytes, book.sizeBytes || 0)
        }
      })

      return missingBytes + largestUpdateBytes
    },
    async browserQuotaAllows(requiredBytes: number): Promise<boolean> {
      if (requiredBytes <= 0) return true
      const estimate = await this.$offline.storageEstimate()
      if (!estimate.quota) return true

      const available = Math.max(0, estimate.quota - estimate.usage)
      const estimatedRequired = Math.ceil(requiredBytes * DOWNLOAD_SIZE_MARGIN) + STORAGE_RESERVE_BYTES
      if (estimatedRequired <= available) return true

      this.$eventHub.$emit(ERROR, {
        message: this.$t('offline.browser_quota_insufficient', {
          required: this.formatBytes(estimatedRequired),
          available: this.formatBytes(available),
        }).toString(),
      })
      return false
    },
    isStorageFullError(error: any): boolean {
      const message = `${error?.message || error || ''}`
      return error?.name === 'QuotaExceededError' || /quota.?exceeded|storage.{0,12}(full|space)/i.test(message)
    },
    async downloadSeries() {
      this.menuState = false
      this.seriesDownloading = true
      try {
        await import(/* webpackChunkName: "read-book" */ '@/views/DivinaReader.vue')
        const books = await this.$komgaBooks.getBooksList({
          condition: new SearchConditionSeriesId(new SearchOperatorIs(this.series.id)),
        } as BookSearch, {unpaged: true, sort: ['metadata.numberSort']})

        if (!(await this.browserQuotaAllows(this.requiredSeriesBytes(books.content)))) return

        for (const book of books.content) {
          const existing = this.$offline.getDownload(book.id)
          if (this.$offline.isDownloaded(book.id) && !existing?.updateAvailable) continue
          try {
            await this.$offline.downloadBook(book.id)
          } catch (e) {
            if (this.isStorageFullError(e)) {
              this.$eventHub.$emit(ERROR, {message: this.$t('offline.device_storage_full').toString()})
              break
            }
            this.$warn(`Offline download failed for ${book.id}`, e)
          }
        }
      } finally {
        this.seriesDownloading = false
      }
    },
    async removeSeriesDownloads() {
      this.menuState = false
      const bookIds = this.$offline.state.downloads
        .filter(record => record.book?.seriesId === this.series.id)
        .map(record => record.bookId)
      for (const bookId of bookIds) await this.$offline.removeDownload(bookId)
    },
    async markRead() {
      await this.$komgaSeries.markAsRead(this.series.id)
    },
    async markUnread() {
      await this.$komgaSeries.markAsUnread(this.series.id)
    },
    promptDeleteSeries() {
      this.$store.dispatch('dialogDeleteSeries', this.series)
    },
  },
})
</script>
