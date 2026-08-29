<template>
  <div>
    <v-menu offset-y>
      <template v-slot:activator="{ on }">
        <v-btn icon v-on="on" @click.prevent="">
          <v-icon>mdi-dots-vertical</v-icon>
        </v-btn>
      </template>
      <v-list dense>
        <template v-if="isPwa">
          <v-list-item :to="{name: 'offline-downloads'}">
            <v-list-item-icon><v-icon small>mdi-download-multiple</v-icon></v-list-item-icon>
            <v-list-item-title>{{ $t('offline.manage_downloads') }}</v-list-item-title>
          </v-list-item>
          <v-divider/>
        </template>
        <v-list-item @click="reorder">
          <v-list-item-title>{{ $t('common.reorder') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="scan(false)" v-if="isAdmin">
          <v-list-item-title>{{ $t('server.server_management.button_scan_libraries') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="scan(true)" class="list-warning" v-if="isAdmin">
          <v-list-item-title>{{ $t('server.server_management.button_scan_libraries_deep') }}</v-list-item-title>
        </v-list-item>
        <v-list-item @click="confirmEmptyTrash = true" v-if="isAdmin">
          <v-list-item-title>{{ $t('server.server_management.button_empty_trash') }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>

    <confirmation-dialog
      v-model="confirmEmptyTrash"
      :title="$t('dialog.empty_trash.title')"
      :body="$t('dialog.empty_trash.body')"
      :button-confirm="$t('dialog.empty_trash.button_confirm')"
      @confirm="emptyTrash"
    />
  </div>
</template>
<script lang="ts">
import Vue from 'vue'
import ConfirmationDialog from '@/components/dialogs/ConfirmationDialog.vue'
import {isStandalonePwa} from '@/functions/pwa'

export default Vue.extend({
  name: 'LibrariesActionsMenu',
  components: {ConfirmationDialog},
  data: () => {
    return {
      confirmEmptyTrash: false,
    }
  },
  computed: {
    isPwa(): boolean {
      return isStandalonePwa()
    },
    isAdmin(): boolean {
      return this.$store.getters.meAdmin
    },
  },
  methods: {
    reorder() {
      this.$emit('reorder')
    },
    scan(scanDeep: boolean) {
      this.$store.state.komgaLibraries.libraries.forEach(library => {
        this.$komgaLibraries.scanLibrary(library, scanDeep)
      })
    },
    emptyTrash() {
      this.$store.state.komgaLibraries.libraries.forEach(library => {
        this.$komgaLibraries.emptyTrash(library)
      })
    },
  },
})
</script>
<style scoped>
@import "../../styles/list-warning.css";
</style>
