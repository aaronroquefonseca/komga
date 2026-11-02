<template>
  <ItemCard
    :id="id"
    :title="title"
    :lines="lines"
    :poster-url="seriesPosterUrl(series.id, cacheStore.getVersion(series.id))"
    :top-right="unreadCount"
    :top-right-icon="isRead ? 'i-mdi:check' : undefined"
    :fab-icon="canRead ? 'i-mdi:play' : undefined"
    :quick-action-icon="quickActionIcon"
    :quick-action-props="quickActionProps"
    :menu-icon="menuIcon"
    :menu-props="menuProps"
    :card-to="linkTo"
    v-bind="propsLeft"
    @selection="(val, event) => emit('selection', val, event)"
    @click-quick-action="showEditMetadataDialog()"
    @card-long-press="bottomSheet = true"
    @click-fab="openReader"
  />
  <SeriesMenuSheet
    v-model="bottomSheet"
    :series="series"
    :activator="menuActivator"
    add-select-action
  />
</template>

<script setup lang="ts">
import { seriesPosterUrl } from '@/api/images'
import { useIntl } from 'vue-intl'
import type { ItemCardEmits, ItemCardLine, ItemCardProps, ItemCardTitle } from '@/types/ItemCard'
import { useCurrentUser } from '@/colada/users'

import { useEditSeriesMetadataDialog } from '@/composables/series/useEditSeriesMetadataDialog'
import { useBooks } from '@/composables/book/useBooks'
import { useSeries } from '@/composables/series/useSeries'
import type { SeriesDto } from '@/generated/openapi'
import { useImageCacheStore } from '@/stores/image-cache'
import { useOfflineLibraryStore } from '@/offline'
import { BrowsingContextKey, formatBrowsingContextAsQueryParam } from '@/functions/browsing-context'
import type { RouteLocationObject } from '@/types/route'
import type { SortKeysSeries } from '@/types/sort'
import { commonMessages } from '@/utils/i18n/common-messages'

const intl = useIntl()
const cacheStore = useImageCacheStore()
const offline = useOfflineLibraryStore()
void offline.whenReady()

const offlineLine = computed<ItemCardLine | undefined>(() => {
  const records = offline.downloads.filter((record) => record.book.seriesId === series.value.id)
  if (records.length === 0) return undefined
  const downloaded = records.filter((record) => offline.isDownloaded(record.bookId)).length
  if (downloaded === 0) return undefined
  const needsUpdate = records.some(
    (record) => record.updateAvailable === true && !record.sourceMissing,
  )
  if (needsUpdate)
    return {
      text: intl.formatMessage({
        description: 'Offline badge: update available',
        defaultMessage: 'Offline update available',
        id: 'U7M5+U',
      }),
      classes: 'text-warning',
    }
  if (series.value.booksCount > 0 && downloaded >= series.value.booksCount)
    return {
      text: intl.formatMessage({
        description: 'Offline badge: available',
        defaultMessage: 'Offline',
        id: 'tYL+3r',
      }),
      classes: 'text-success',
    }
  return undefined
})

const lines = computed<ItemCardLine[]>(() =>
  offlineLine.value ? [footer.value, offlineLine.value] : [footer.value],
)

const id = useId()

const props = defineProps<
  {
    series: SeriesDto
  } & ItemCardProps
>()
const emit = defineEmits<ItemCardEmits>()

const bottomSheet = ref(false)

const series = toRef(props, 'series')
const propsLeft = computed(() => {
  const { series, ...rest } = props
  return rest
})

const { isRead, unreadCount, canRead } = useSeries(series)

const title = computed<ItemCardTitle>(() => ({
  text: series.value.metadata.title,
  lines: 2,
  routerLink: linkTo.value,
}))

const excludedKeys = ['metadata.titleSort', 'readDate', 'booksCount', 'random'] as const
type SortKeysSupported = Exclude<SortKeysSeries, (typeof excludedKeys)[number]>
const footer = computed<ItemCardLine>(() => {
  if (series.value.deleted)
    return {
      text: intl.formatMessage({
        description: 'Series card subtitle: unavailable',
        defaultMessage: 'Unavailable',
        id: 'wbH42A',
      }),
      classes: 'text-error',
    }

  const sortKey = props.sortActive?.find(
    (it) => !(excludedKeys as readonly string[]).includes(it.key),
  )
  if (sortKey) {
    switch (sortKey.key as SortKeysSupported) {
      case 'createdDate':
        return {
          text: intl.formatDate(series.value.created, { dateStyle: 'medium' }),
        }
      case 'lastModifiedDate':
        return {
          text: intl.formatDate(series.value.lastModified, { dateStyle: 'medium' }),
        }
      case 'booksMetadata.releaseDate':
        return {
          text: series.value.booksMetadata.releaseDate
            ? intl.formatDate(series.value.booksMetadata.releaseDate, { year: 'numeric' })
            : intl.formatMessage(commonMessages.cardSubtitleNoReleaseDate),
        }
      case 'name':
        return { text: series.value.name }
    }
  }

  if (series.value.oneshot) {
    return {
      text: intl.formatMessage({
        description: 'Series card subtitle: oneshot',
        defaultMessage: 'One-shot',
        id: 'NKVL81',
      }),
    }
  }

  return {
    text: intl.formatMessage(
      {
        description: 'Series card subtitle: count of books',
        defaultMessage: `{count, plural,
one {# book}
other {# books}
}`,
        id: 'cGOJnB',
      },
      { count: series.value.booksCount },
    ),
  }
})

const context = inject(BrowsingContextKey, undefined)
const linkTo = computed<RouteLocationObject>(() => ({
  name: '/series/[id]',
  params: { id: series.value.id },
  query: formatBrowsingContextAsQueryParam(toValue(context)),
}))

const { isAdmin } = useCurrentUser()
const quickActionIcon = computed(() => (isAdmin.value ? 'i-mdi:pencil' : undefined))
const quickActionProps = computed(() => ({
  id: `${id}_quick`,
  onmouseenter: () => (editMetadataActivator.value = `#${id}_quick`),
}))
const menuIcon = computed(() => (isAdmin.value ? 'i-mdi:dots-vertical' : undefined))
const menuProps = computed(() => ({
  onmouseenter: (event: Event) => (menuActivator.value = event.currentTarget as Element),
}))

const {
  prepareDialog: prepareEditSeriesMetadataDialog,
  showDialog: showEditSeriesMetadataDialog,
  activator: editMetadataActivator,
} = useEditSeriesMetadataDialog()

function showEditMetadataDialog() {
  prepareEditSeriesMetadataDialog(series.value)
  showEditSeriesMetadataDialog()
}

const menuActivator = ref()

const { readFirstBook } = useBooks(series)
function openReader() {
  void readFirstBook()
}
</script>
