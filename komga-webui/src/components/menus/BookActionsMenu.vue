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
          <v-list-item
            v-if="canOfflineDownload && !downloadRecord"
            :disabled="!$offline.state.online || $offline.state.offlineMode"
            @click="downloadOffline"
          >
            <v-list-item-icon><v-icon small>mdi-download-box-outline</v-icon></v-list-item-icon>
            <v-list-item-title>{{ $t('offline.save_offline') }}</v-list-item-title>
          </v-list-item>
          <v-list-item
            v-else-if="downloadRecord && (downloadRecord.status === 'downloading' || downloadRecord.status === 'updating')"
            disabled
          >
            <v-list-item-icon><v-icon small>mdi-download</v-icon></v-list-item-icon>
            <v-list-item-title>
              {{ $t(downloadRecord.status === 'updating' ? 'offline.updating' : 'offline.downloading') }}
              {{ downloadRecord.completedPages }} / {{ downloadRecord.totalPages }}
            </v-list-item-title>
          </v-list-item>
          <v-list-item
            v-else-if="downloadRecord && downloadRecord.status === 'error'"
            :disabled="!$offline.state.online || $offline.state.offlineMode"
            @click="downloadOffline"
          >
            <v-list-item-icon><v-icon small>mdi-refresh</v-icon></v-list-item-icon>
            <v-list-item-title>{{ $t('offline.retry_download') }}</v-list-item-title>
          </v-list-item>
          <template v-else-if="downloadRecord && downloadRecord.status === 'downloaded'">
            <v-list-item
              v-if="downloadRecord.updateAvailable && !downloadRecord.sourceMissing"
              :disabled="!$offline.state.online || $offline.state.offlineMode"
              @click="downloadOffline"
            >
              <v-list-item-icon><v-icon small>mdi-update</v-icon></v-list-item-icon>
              <v-list-item-title>{{ $t('offline.update_copy') }}</v-list-item-title>
            </v-list-item>
            <v-list-item @click="removeOffline">
              <v-list-item-icon><v-icon small>mdi-download-box</v-icon></v-list-item-icon>
              <v-list-item-title>{{ $t('offline.remove_download') }}</v-list-item-title>
            </v-list-item>
          </template>
          <v-list-item :to="{name: 'offline-downloads'}">
            <v-list-item-icon><v-icon small>mdi-download-multiple</v-icon></v-list-item-icon>
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
        <v-list-item @click="addToReadList" v-if="isAdmin">
          <v-list-item-title>{{ $t('menu.add_to_readlist') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="markRead" v-if="!isRead">
          <v-list-item-title>{{ $t('menu.mark_read') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="markUnread" v-if="!isUnread">
          <v-list-item-title>{{ $t('menu.mark_unread') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="promptDeleteBook" class="list-danger" v-if="isAdmin">
          <v-list-item-title>{{ $t('menu.delete') }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>
<script lang="ts">
import {getReadProgress} from '@/functions/book-progress'
import {isStandalonePwa} from '@/functions/pwa'
import {MediaStatus, ReadStatus} from '@/types/enum-books'
import Vue from 'vue'
import {BookDto, ReadProgressUpdateDto} from '@/types/komga-books'
import {OfflineDownloadRecord} from '@/services/offline-library.service'

export default Vue.extend({
  name: 'BookActionsMenu',
  data: () => ({
    menuState: false,
  }),
  props: {
    book: {
      type: Object as () => BookDto,
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
      return getReadProgress(this.book) === ReadStatus.READ
    },
    isUnread(): boolean {
      return getReadProgress(this.book) === ReadStatus.UNREAD
    },
    canOfflineDownload(): boolean {
      return this.book.media?.status === MediaStatus.READY && this.$store.getters.mePageStreaming
    },
    downloadRecord(): OfflineDownloadRecord | undefined {
      return this.$offline.getDownload(this.book.id)
    },
  },
  methods: {
    analyze() {
      this.$komgaBooks.analyzeBook(this.book)
    },
    refreshMetadata() {
      this.$komgaBooks.refreshMetadata(this.book)
    },
    addToReadList() {
      this.$store.dispatch('dialogAddBooksToReadList', [this.book.id])
    },
    async markRead() {
      const readProgress = {completed: true} as ReadProgressUpdateDto
      await this.$komgaBooks.updateReadProgress(this.book.id, readProgress)
    },
    async markUnread() {
      await this.$komgaBooks.deleteReadProgress(this.book.id)
    },
    async downloadOffline() {
      this.menuState = false
      // Force Vue CLI's lazy reader chunk (and its CSS/dependencies) through the
      // active service worker before the device can lose connectivity.
      await import(/* webpackChunkName: "read-book" */ '@/views/DivinaReader.vue')
      await this.$offline.downloadBook(this.book.id)
    },
    async removeOffline() {
      this.menuState = false
      await this.$offline.removeDownload(this.book.id)
    },
    promptDeleteBook() {
      this.$store.dispatch('dialogDeleteBook', this.book)
    },
  },
})
</script>