import { useCurrentUser } from '@/colada/users'
import { useIntl } from 'vue-intl'
import { storeToRefs } from 'pinia'
import { type DialogResult, useDialogsStore } from '@/stores/dialogs'
import { useMessagesStore } from '@/stores/messages'
import { useDisplay } from 'vuetify/framework'
import BookDeletionWarning from '@/components/book/DeletionWarning.vue'
import { commonMessages } from '@/utils/i18n/common-messages'
import {
  useAnalyzeBook,
  useDeleteBook,
  useMarkBookRead,
  useMarkBookUnread,
  useRefreshMetadataBook,
} from '@/colada/books'
import { useEditBookMetadataDialog } from '@/composables/book/useEditBookMetadataDialog'
import { bookFileUrl } from '@/api/files'
import { type Action, actionDetails, ActionName } from '@/types/action/action'
import { useBook } from '@/composables/book/useBook'
import { useBookReadProgress } from '@/composables/book/useBookReadProgress'
import { bookReaderUrl } from '@/api/links'
import type { BookDto } from '@/generated/openapi'
import { useAddToReadListDialog } from '@/composables/book/useAddToReadListDialog'
import { useAddToCollectionDialog } from '@/composables/series/useAddToCollectionDialog'
import { useOfflineLibraryStore } from '@/offline'
import { MediaStatus } from '@/types/MediaStatus'

export function useBookActions(
  book: MaybeRefOrGetter<BookDto>,
  callback: (action: ActionName) => void = () => {},
) {
  const { isAdmin, hasRole } = useCurrentUser()
  const intl = useIntl()
  const router = useRouter()
  const { confirm: dialogConfirm } = storeToRefs(useDialogsStore())
  const messagesStore = useMessagesStore()
  const display = useDisplay()
  const { canRead, isEpubReader } = useBook(book)
  const { inProgress } = useBookReadProgress(book)

  const offline = useOfflineLibraryStore()
  void offline.whenReady()

  const canSaveOffline = computed(
    () => hasRole('FILE_DOWNLOAD') && toValue(book).media?.status === MediaStatus.Ready,
  )
  const download = computed(() => offline.getDownload(toValue(book).id))
  const offlineBusy = computed(() => !offline.online || offline.offlineMode)

  function openReader(incognito = false) {
    offline.readerOpened(toValue(book).id)
    window.open(bookReaderUrl(toValue(book).id, isEpubReader.value, incognito), '_self')
  }

  async function saveOffline() {
    try {
      await offline.downloadBook(toValue(book).id)
    } catch (error) {
      messagesStore.messages.push(
        error instanceof Error ? error.message : commonMessages.networkError,
      )
    }
    callback(ActionName.SaveOffline)
  }

  async function retryDownload() {
    try {
      await offline.downloadBook(toValue(book).id)
    } catch (error) {
      messagesStore.messages.push(
        error instanceof Error ? error.message : commonMessages.networkError,
      )
    }
    callback(ActionName.RetryDownload)
  }

  async function resumeDownload() {
    try {
      await offline.resumeDownload(toValue(book).id)
    } catch (error) {
      messagesStore.messages.push(
        error instanceof Error ? error.message : commonMessages.networkError,
      )
    }
    callback(ActionName.RetryDownload)
  }

  async function removeDownload() {
    try {
      await offline.removeDownload(toValue(book).id)
    } catch (error) {
      messagesStore.messages.push(
        error instanceof Error ? error.message : commonMessages.networkError,
      )
    }
    callback(ActionName.RemoveDownload)
  }

  const offlineActions = computed<Action<ActionName>[]>(() => {
    if (!canSaveOffline.value) return []
    const record = download.value
    const busyLabel =
      record?.status === 'updating'
        ? intl.formatMessage({
            description: 'Downloads page: updating',
            defaultMessage: 'Updating',
            id: 'zmI2mA',
          })
        : intl.formatMessage({
            description: 'Downloads page: downloading',
            defaultMessage: 'Downloading',
            id: 'omwGFp',
          })

    if (!record) {
      return [
        {
          title: intl.formatMessage(actionDetails[ActionName.SaveOffline].message),
          icon: actionDetails[ActionName.SaveOffline].icon,
          action: ActionName.SaveOffline,
          disabled: offlineBusy.value,
          onClick: () => void saveOffline(),
        },
      ]
    }

    if (['queued', 'downloading', 'updating'].includes(record.status)) {
      return [
        {
          title: intl.formatMessage(
            {
              description: 'Book menu: downloading with progress',
              defaultMessage: 'Downloading {done}/{total}',
              id: 'Qol9qn',
            },
            { done: record.completedPages, total: record.totalPages },
          ),
          icon: 'i-mdi:download',
          action: ActionName.SaveOffline,
          disabled: true,
          onClick: () => {},
        },
        {
          title: intl.formatMessage(actionDetails[ActionName.RemoveDownload].message),
          icon: actionDetails[ActionName.RemoveDownload].icon,
          action: ActionName.RemoveDownload,
          onClick: () => void removeDownload(),
        },
      ]
    }

    if (record.status === 'paused') {
      return [
        {
          title: intl.formatMessage({
            description: 'Book menu: paused',
            defaultMessage: 'Download paused',
            id: 'plmAPV',
          }),
          icon: 'i-mdi:pause-circle',
          action: ActionName.RetryDownload,
          disabled: true,
          onClick: () => {},
        },
        {
          title: intl.formatMessage(actionDetails[ActionName.RetryDownload].message),
          icon: actionDetails[ActionName.RetryDownload].icon,
          action: ActionName.RetryDownload,
          disabled: offlineBusy.value,
          onClick: () => void resumeDownload(),
        },
        {
          title: intl.formatMessage(actionDetails[ActionName.RemoveDownload].message),
          icon: actionDetails[ActionName.RemoveDownload].icon,
          action: ActionName.RemoveDownload,
          onClick: () => void removeDownload(),
        },
      ]
    }

    if (record.status === 'error') {
      return [
        {
          title: intl.formatMessage(actionDetails[ActionName.RetryDownload].message),
          icon: actionDetails[ActionName.RetryDownload].icon,
          action: ActionName.RetryDownload,
          disabled: offlineBusy.value,
          onClick: () => void retryDownload(),
        },
        {
          title: intl.formatMessage(actionDetails[ActionName.RemoveDownload].message),
          icon: actionDetails[ActionName.RemoveDownload].icon,
          action: ActionName.RemoveDownload,
          onClick: () => void removeDownload(),
        },
      ]
    }

    // downloaded (possibly with updateAvailable / sourceMissing / kept-copy error)
    const rows: Action<ActionName>[] = [
      {
        title: intl.formatMessage({
          description: 'Book menu: available offline',
          defaultMessage: 'Available offline',
          id: '4ir1Tm',
        }),
        icon: 'i-mdi:check-circle',
        action: ActionName.SaveOffline,
        disabled: true,
        onClick: () => {},
      },
    ]
    if (busyLabel && record.updateAvailable && !record.sourceMissing) {
      rows.push({
        title: intl.formatMessage({
          description: 'Book menu: update available',
          defaultMessage: 'Update available',
          id: '2MahXh',
        }),
        icon: 'i-mdi:update',
        action: ActionName.RetryDownload,
        disabled: offlineBusy.value,
        onClick: () => void retryDownload(),
      })
    }
    rows.push({
      title: intl.formatMessage(actionDetails[ActionName.RemoveDownload].message),
      icon: actionDetails[ActionName.RemoveDownload].icon,
      action: ActionName.RemoveDownload,
      onClick: () => void removeDownload(),
    })
    return rows
  })

  const manageDownloadsAction = computed<Action<ActionName>[]>(() =>
    canSaveOffline.value
      ? [
          {
            title: intl.formatMessage(actionDetails[ActionName.ManageDownloads].message),
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

  const actions = computed<Action<ActionName>[]>(() => {
    const items: Action<ActionName>[] = [
      ...offlineActions.value,
      ...manageDownloadsAction.value,
      ...(isAdmin.value && toValue(book).oneshot
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
      ...(!toValue(book).readProgress?.completed
        ? [
            {
              title: intl.formatMessage(actionDetails[ActionName.MarkRead].message),
              icon: actionDetails[ActionName.MarkRead].icon,
              action: ActionName.MarkRead,
              onClick: () => {
                markRead()
              },
            },
          ]
        : []),
      ...(!!toValue(book).readProgress
        ? [
            {
              title: intl.formatMessage(actionDetails[ActionName.MarkUnread].message),
              icon: actionDetails[ActionName.MarkUnread].icon,
              action: ActionName.MarkUnread,
              onClick: () => {
                markUnread()
              },
            },
          ]
        : []),
      ...(hasRole('FILE_DOWNLOAD')
        ? [
            {
              title: intl.formatMessage(actionDetails[ActionName.Download].message),
              action: ActionName.Download,
              href: bookFileUrl(toValue(book).id),
              onClick: () => {
                callback(ActionName.Download)
              },
            },
          ]
        : []),
      ...(isAdmin.value
        ? [
            {
              title: intl.formatMessage(actionDetails[ActionName.EditBook].message),
              icon: actionDetails[ActionName.EditBook].icon,
              action: ActionName.EditBook,
              onMouseenter: (event: Event) =>
                (editMetadataActivator.value = event.currentTarget as Element),
              onClick: () => {
                updateBookMetadata(() => callback(ActionName.EditBook))
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
                analyzeBook()
              },
            },
          ]
        : []),
      ...(isAdmin.value
        ? [
            {
              title: intl.formatMessage({
                description: 'Book menu: manage > delete file',
                defaultMessage: 'Delete file',
                id: 'vXhkpo',
              }),
              action: ActionName.Delete,
              onMouseenter: (event: Event) =>
                (dialogConfirm.value.activator = event.currentTarget as Element),
              onClick: () => {
                deleteBook()
              },
            },
          ]
        : []),
      {
        title: inProgress.value
          ? intl.formatMessage({
              description: 'Book menu: resume reading button',
              defaultMessage: 'Resume',
              id: 'cIM3eJ',
            })
          : intl.formatMessage({
              description: 'Book menu: read button',
              defaultMessage: 'Read',
              id: 'Y8SsFO',
            }),
        icon: actionDetails[ActionName.OpenReader].icon,
        action: ActionName.OpenReader,
        disabled:
          !canRead.value ||
          (offlineBusy.value && (!offline.isDownloaded(toValue(book).id) || isEpubReader.value)),
        onClick: () => {
          openReader(false)
          callback(ActionName.OpenReader)
        },
      },
      {
        title: intl.formatMessage(actionDetails[ActionName.OpenReaderIncognito].message),
        icon: actionDetails[ActionName.OpenReaderIncognito].icon,
        action: ActionName.OpenReaderIncognito,
        disabled:
          !canRead.value ||
          (offlineBusy.value && (!offline.isDownloaded(toValue(book).id) || isEpubReader.value)),
        onClick: () => {
          openReader(true)
          callback(ActionName.OpenReaderIncognito)
        },
      },
    ]
    const serverActions: ActionName[] = [
      ActionName.EditBook,
      ActionName.RefreshMetadata,
      ActionName.Analyze,
      ActionName.Delete,
      ActionName.Download,
      ActionName.AddToCollection,
      ActionName.AddToReadList,
      ActionName.MarkUnread,
    ]
    return items.map((action) => ({
      ...action,
      disabled: action.disabled || (offlineBusy.value && serverActions.includes(action.action)),
    }))
  })

  //region Add to collection
  const { prepareDialog: showAddToCollectionDialog, activator: addToCollectionActivator } =
    useAddToCollectionDialog()

  function addToCollection(callback: () => void) {
    showAddToCollectionDialog([toValue(book).seriesId], callback)
  }
  //endregion

  //region Add to read list
  const { prepareDialog: showAddToReadListDialog, activator: addToReadListActivator } =
    useAddToReadListDialog()

  function addToReadList(callback: () => void) {
    showAddToReadListDialog([toValue(book)], callback)
  }
  //endregion

  //region Update Book metadata
  const { prepareDialog: showEditBookMetadataDialog, activator: editMetadataActivator } =
    useEditBookMetadataDialog()

  function updateBookMetadata(callback: () => void) {
    showEditBookMetadataDialog(toValue(book), callback)
  }
  //endregion

  //region Refresh Metadata
  const { mutate: mutateRefreshMetadata } = useRefreshMetadataBook()

  function refreshMetadata() {
    mutateRefreshMetadata(toValue(book).id)
    callback(ActionName.RefreshMetadata)
  }
  //endregion

  //region Analyze
  const { mutate: mutateAnalyze } = useAnalyzeBook()

  function analyzeBook() {
    mutateAnalyze(toValue(book).id)
    callback(ActionName.Analyze)
  }
  //endregion

  //region Mark read
  const { mutate: mutateMarkRead } = useMarkBookRead()

  function markRead() {
    mutateMarkRead(toValue(book).id)
    callback(ActionName.MarkRead)
  }
  //endregion

  //region Mark unread
  const { mutate: mutateMarkUnread } = useMarkBookUnread()

  function markUnread() {
    mutateMarkUnread(toValue(book).id)
    callback(ActionName.MarkUnread)
  }
  //endregion

  //region Delete
  const { mutateAsync: mutateDelete } = useDeleteBook()

  function deleteBook() {
    dialogConfirm.value.dialogProps = {
      title: intl.formatMessage({
        description: 'Book delete dialog: title',
        defaultMessage: 'Delete book files',
        id: 'NhIart',
      }),
      subtitle: toValue(book).metadata.title,
      maxWidth: 600,
      mode: 'checkbox',
      color: 'error',
      okText: intl.formatMessage({
        description: 'Book delete dialog: confirm button',
        defaultMessage: 'Delete files',
        id: '8CVWWg',
      }),
      closeOnSave: true,
      fullscreen: display.xs.value,
    }
    dialogConfirm.value.slotWarning = {
      component: markRaw(BookDeletionWarning),
      props: {},
    }
    dialogConfirm.value.callback = (result: DialogResult) => {
      if (result === 'confirm') {
        mutateDelete(toValue(book).id)
          .then(() => {
            messagesStore.messages.push({
              message: intl.formatMessage(
                {
                  description: 'Snackbar notification shown upon successful book files deletion',
                  defaultMessage: 'Book files deleted: {book}',
                  id: 'ccDES8',
                },
                {
                  book: toValue(book).metadata.title,
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
