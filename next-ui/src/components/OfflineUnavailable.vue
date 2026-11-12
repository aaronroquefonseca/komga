<template>
  <v-empty-state
    icon="i-mdi:cloud-off-outline"
    :title="
      $formatMessage({
        defaultMessage: 'Unavailable offline',
        id: 'GkDyZf',
        description: 'Offline unavailable title',
      })
    "
    :text="
      $formatMessage({
        defaultMessage:
          'This content is not saved on this device. Connect to your server to load it, or choose a downloaded book.',
        id: 'TH27e8',
        description: 'Offline unavailable explanation',
      })
    "
  >
    <template #actions>
      <v-btn
        to="/downloads"
        color="primary"
        prepend-icon="i-mdi:download"
        :text="
          $formatMessage({
            defaultMessage: 'Open Downloads',
            id: '7uSsRk',
            description: 'Offline downloads action',
          })
        "
      />
    </template>
  </v-empty-state>
</template>
