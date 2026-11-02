import { commonMessages } from '@/utils/i18n/common-messages'
import { type DialogResult, useDialogsStore } from '@/stores/dialogs'
import { storeToRefs } from 'pinia'
import { useIntl } from 'vue-intl'
import { useDisplay } from 'vuetify'
import { useMessagesStore } from '@/stores/messages'
import {
  useAnalyzeSeries,
  useDeleteSeries,
  useMarkSeriesRead,
  useMarkSeriesUnread,
  useRefreshMetadataSeries,
} from '@/colada/series'
import { useCurrentUser } from '@/colada/users'
import SeriesDeletionWarning from '@/components/series/DeletionWarning.vue'
import { useEditSeriesMetadataDialog } from '@/composables/series/useEditSeriesMetadataDialog'
import { seriesFileUrl } from '@/api/files'
import { type Action, actionDetails, ActionName } from '@/types/action/action'
import { useBooks } from '@/composables/book/useBooks'
import { useSeries } from '@/composables/series/useSeries'
import type { SeriesDto } from '@/generated/openapi'
import { useAddToReadListDialog } from '@/composables/book/useAddToReadListDialog'
import { useAddToCollectionDialog } from '@/composables/series/useAddToCollectionDialog'
import { useOfflineLibraryStore } from '@/offline'
import { isStandalonePwa } from '@/functions/pwa'
import { komgaGetBooks } from '@/generated/openapi'

export function useSeriesActions(
  series: MaybeRefOrGetter<SeriesDto>,
  callback: (action: ActionName) => void = () => {},
) {
  const { isAdmin, hasRole } = useCurrentUser()
  const intl = useIntl()
  const router = useRouter()
  const { confirm: dialogConfirm } = storeToRefs(useDialogsStore())
  const messagesStore = useMessagesStore()
  const display = useDisplay()
  const { readFirstBook } = useBooks(series)
  const { canRead, inProgress } = useSeries(series)

  const offline = useOfflineLibraryStore()
  void offline.whenReady()

  const canSaveOffline = computed(() => isStandalonePwa() && hasRole('FILE_DOWNLOAD'))
  const offlineBusy = computed(() => !offline.online || offline.offlineMode)
  const seriesDownloading = ref(false)

  const seriesDownloads = computed(() =>
    offline.downloads.filter((record) => record.book.seriesId === toValue(series).id),
  )
  const downloadedBookCount = computed(
    () => seriesDownloads.value.filter((record) => offline.isDownloaded(record.bookId)).length,
  )
  const seriesAllDownloaded = computed(
    () => toValue(series).booksCount > 0 && downloadedBookCount.value >= toValue(series).booksCount,
  )
  const seriesNeedsUpdate = computed(() =>
    seriesDownloads.value.some(
      (record) => record.updateAvailable === true && !record.sourceMissing,
    ),
  )
  const seriesHasActive = computed(() =>
    seriesDownloads.value.some((record) =>
      ['queued', 'downloading', 'updating'].includes(record.status),
    ),
  )
  const seriesBusy = computed(() => seriesDownloading.value || seriesHasActive.value)

  async function downloadSeries() {
    seriesDownloading.value = true
    try {
      const page = await komgaGetBooks({
        body: { condition: { seriesId: { operator: 'is', value: toValue(series).id } } },
        query: { unpaged: true, sort: ['metadata.numberSort'] },
      })
      const books = page.content ?? []
      const pending = books.filter((book) => {
        const existing = offline.getDownload(book.id)
        return !offline.isDownloaded(book.id) || !!existing?.updateAvailable
      })
      await offline.downloadBooks(pending, toValue(series).id)
    } catch (error) {
      messagesStore.messages.push(
        error instanceof Error ? error.message : commonMessages.networkError,
      )
    } finally {
      seriesDownloading.value = false
    }
    callback(ActionName.SaveOffline)
  }

  async function removeSeriesDownloads() {
    try {
      const bookIds = seriesDownloads.value.map((record) => record.bookId)
      for (const bookId of bookIds) await offline.removeDownload(bookId)
    } catch (error) {
      messagesStore.messages.push(
        error instanceof Error ? error.message : commonMessages.networkError,
      )
    }
    callback(ActionName.RemoveDownload)
  }

  const offlineActions = computed<Action<ActionName>[]>(() => {
    if (!canSaveOffline.value) return []
    const rows: Action<ActionName>[] = []
    const total = toValue(series).booksCount

    if (seriesBusy.value) {
      rows.push({
        title: intl.formatMessage(
          {
            description: 'Series menu: downloading with progress',
            defaultMessage: 'Downloading {downloaded}/{total}',
            id: '72+FCB',
          },
          { downloaded: downloadedBookCount.value, total },
        ),
        icon: 'i-mdi:download',
        action: ActionName.SaveOffline,
        disabled: true,
        onClick: () => {},
      })
      return rows
    }

    if (!seriesAllDownloaded.value || seriesNeedsUpdate.value) {
      const title =
        seriesAllDownloaded.value && seriesNeedsUpdate.value
          ? intl.formatMessage({
              description: 'Series menu: update series',
              defaultMessage: 'Update offline series',
              id: 'eoPZ4l',
            })
          : downloadedBookCount.value === 0
            ? intl.formatMessage({
                description: 'Series menu: save offline',
                defaultMessage: 'Save series offline',
                id: 'u4D78u',
              })
            : intl.formatMessage(
                {
                  description: 'Series menu: download remaining',
                  defaultMessage: 'Download remaining ({downloaded}/{total})',
                  id: '55nOFo',
                },
                { downloaded: downloadedBookCount.value, total },
              )
      rows.push({
        title,
        icon: seriesNeedsUpdate.value ? 'i-mdi:update' : 'i-mdi:download-multiple',
        action: ActionName.SaveOffline,
        disabled: offlineBusy.value,
        onClick: () => void downloadSeries(),
      })
    }

    if (downloadedBookCount.value > 0) {
      rows.push({
        title: intl.formatMessage({
          description: 'Series menu: remove downloads',
          defaultMessage: 'Remove offline copies',
          id: 'Te5oRu',
        }),
        icon: 'i-mdi:download-off',
        action: ActionName.RemoveDownload,
        onClick: () => void removeSeriesDownloads(),
      })
    }

    return rows
  })

  const manageDownloadsAction = computed<Action<ActionName>[]>(() =>
    canSaveOffline.value
      ? [
          {
            title: intl.formatMessage({
              description: 'Series menu: manage downloads',
              defaultMessage: 'Manage downloads',
              id: 'Lijq0W',
            }),
            icon: actionDetails[ActionName.ManageDownloads].icon,
            action: ActionName.ManageDownloads,
            onClick: () => {
              void router.push('/downloads')
              callback(ActionName.ManageDownloads)
            },
          },
        ]
      : [],
  )

  const actions = computed<Action<ActionName>[]>(() => [
    ...offlineActions.value,
    ...manageDownloadsAction.value,
    ...(isAdmin.value
      ? [
          {
            title: intl.formatMessage(actionDetails[ActionName.AddToCollection].message),
            action: ActionName.AddToCollection,
            onMouseenter: (event: Event) =>
              (addToCollectionActivator.value = event.currentTarget as Element),
            onClick: () => {
              addToCollection(() => callback(ActionName.AddToCollection))
            },
          },
        ]
      : []),
    ...(isAdmin.value
      ? [
          {
            title: intl.formatMessage(actionDetails[ActionName.AddToReadList].message),
            action: ActionName.AddToReadList,
            onMouseenter: (event: Event) =>
              (addToReadListActivator.value = event.currentTarget as Element),
            onClick: () => {
              addToReadList(() => callback(ActionName.AddToReadList))
            },
          },
        ]
      : []),
    ...(toValue(series).booksReadCount === toValue(series).booksCount
      ? []
      : [
          {
            title: intl.formatMessage(actionDetails[ActionName.MarkRead].message),
            icon: actionDetails[ActionName.MarkRead].icon,
            action: ActionName.MarkRead,
            onClick: () => {
              markRead()
            },
          },
        ]),
    ...(toValue(series).booksUnreadCount === toValue(series).booksCount
      ? []
      : [
          {
            title: intl.formatMessage(actionDetails[ActionName.MarkUnread].message),
            icon: actionDetails[ActionName.MarkUnread].icon,
            action: ActionName.MarkUnread,
            onClick: () => {
              markUnread()
            },
          },
        ]),
    ...(hasRole('FILE_DOWNLOAD')
      ? [
          {
            title: intl.formatMessage(actionDetails[ActionName.Download].message),
            action: ActionName.Download,
            href: seriesFileUrl(toValue(series).id),
            onClick: () => {
              callback(ActionName.Download)
            },
          },
        ]
      : []),
    ...(isAdmin.value
      ? [
          {
            title: intl.formatMessage(actionDetails[ActionName.EditSeries].message),
            icon: actionDetails[ActionName.EditSeries].icon,
            action: ActionName.EditSeries,
            onMouseenter: (event: Event) =>
              (editMetadataActivator.value = event.currentTarget as Element),
            onClick: () => {
              updateSeriesMetadata(() => callback(ActionName.EditSeries))
            },
          },
        ]
      : []),
    ...(isAdmin.value
      ? [
          {
            title: intl.formatMessage(actionDetails[ActionName.RefreshMetadata].message),
            action: ActionName.RefreshMetadata,
            onClick: () => {
              refreshMetadata()
            },
          },
        ]
      : []),
    ...(isAdmin.value
      ? [
          {
            title: intl.formatMessage(actionDetails[ActionName.Analyze].message),

            action: ActionName.Analyze,
            onClick: () => {
              analyzeSeries()
            },
          },
        ]
      : []),
    ...(isAdmin.value
      ? [
          {
            title: intl.formatMessage({
              description: 'Series menu: manage > delete file',
              defaultMessage: 'Delete files',
              id: 'J+H9cC',
            }),
            action: ActionName.Delete,
            onMouseenter: (event: Event) =>
              (dialogConfirm.value.activator = event.currentTarget as Element),
            onClick: () => {
              deleteSeries()
            },
          },
        ]
      : []),
    {
      title: inProgress.value
        ? intl.formatMessage({
            description: 'Series menu: resume reading button',
            defaultMessage: 'Resume',
            id: 'wXGljO',
          })
        : intl.formatMessage({
            description: 'Series menu: read button',
            defaultMessage: 'Read',
            id: 'Y7Y2T0',
          }),
      icon: actionDetails[ActionName.OpenReader].icon,
      action: ActionName.OpenReader,
      disabled: !canRead.value,
      onClick: () => {
        void readFirstBook()
        callback(ActionName.OpenReader)
      },
    },
    {
      title: intl.formatMessage(actionDetails[ActionName.OpenReaderIncognito].message),
      icon: actionDetails[ActionName.OpenReaderIncognito].icon,
      action: ActionName.OpenReaderIncognito,
      disabled: !canRead.value,
      onClick: () => {
        void readFirstBook(true)
        callback(ActionName.OpenReaderIncognito)
      },
    },
  ])

  //region Add to collection
  const { prepareDialog: showAddToCollectionDialog, activator: addToCollectionActivator } =
    useAddToCollectionDialog()

  function addToCollection(callback: () => void) {
    showAddToCollectionDialog([toValue(series).id], callback)
  }
  //endregion

  //region Add to read list
  const { prepareDialog: showAddToReadListDialog, activator: addToReadListActivator } =
    useAddToReadListDialog()

  function addToReadList(callback: () => void) {
    showAddToReadListDialog([toValue(series)], callback)
  }
  //endregion

  //region Update Series metadata
  const { prepareDialog: showEditSeriesMetadataDialog, activator: editMetadataActivator } =
    useEditSeriesMetadataDialog()

  function updateSeriesMetadata(callback: () => void) {
    showEditSeriesMetadataDialog(toValue(series), callback)
  }
  //endregion

  //region Refresh Metadata
  const { mutate: mutateRefreshMetadata } = useRefreshMetadataSeries()

  function refreshMetadata() {
    mutateRefreshMetadata(toValue(series).id)
    callback(ActionName.RefreshMetadata)
  }
  //endregion

  //region Analyze
  const { mutate: mutateAnalyze } = useAnalyzeSeries()

  function analyzeSeries() {
    mutateAnalyze(toValue(series).id)
    callback(ActionName.Analyze)
  }
  //endregion

  //region Mark read
  const { mutate: mutateMarkRead } = useMarkSeriesRead()

  function markRead() {
    mutateMarkRead(toValue(series).id)
    callback(ActionName.MarkRead)
  }
  //endregion

  //region Mark unread
  const { mutate: mutateMarkUnread } = useMarkSeriesUnread()

  function markUnread() {
    mutateMarkUnread(toValue(series).id)
    callback(ActionName.MarkUnread)
  }
  //endregion

  //region Delete
  const { mutateAsync: mutateDelete } = useDeleteSeries()

  function deleteSeries() {
    dialogConfirm.value.dialogProps = {
      title: intl.formatMessage({
        description: 'Series delete dialog: title',
        defaultMessage: 'Delete series files',
        id: 'Xxu514',
      }),
      subtitle: toValue(series).metadata.title,
      maxWidth: 600,
      mode: 'checkbox',
      color: 'error',
      okText: intl.formatMessage({
        description: 'Series delete dialog: confirm button',
        defaultMessage: 'Delete files',
        id: 'DfakWW',
      }),
      closeOnSave: true,
      fullscreen: display.xs.value,
    }
    dialogConfirm.value.slotWarning = {
      component: markRaw(SeriesDeletionWarning),
      props: {},
    }
    dialogConfirm.value.callback = (result: DialogResult) => {
      if (result === 'confirm') {
        mutateDelete(toValue(series).id)
          .then(() => {
            messagesStore.messages.push({
              message: intl.formatMessage(
                {
                  description: 'Snackbar notification shown upon successful series files deletion',
                  defaultMessage: 'Series files deleted: {series}',
                  id: 'aSDxrt',
                },
                {
                  series: toValue(series).metadata.title,
                },
              ),
            })
          })
          .catch((error) => {
            messagesStore.messages.push(error?.cause?.message ?? commonMessages.networkError)
          })
      }

      callback(ActionName.Delete)
    }
  }
  //endregion

  return {
    actions: actions,
  }
}
