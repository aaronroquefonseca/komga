import {AxiosInstance} from 'axios'
import _Vue from 'vue'
import OfflineLibraryService from '@/services/offline-library.service'

export default {
  install(Vue: typeof _Vue, {http}: {http: AxiosInstance}) {
    Vue.prototype.$offline = new OfflineLibraryService(http)
  },
}

declare module 'vue/types/vue' {
  interface Vue {
    $offline: OfflineLibraryService;
  }
}
