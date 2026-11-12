<template>
  <v-empty-state
    icon="i-mdi:cloud-off-outline"
    :title="
      $formatMessage({
        defaultMessage: 'Connect to get started',
        id: 'gZyEAs',
        description: 'Offline missing session title',
      })
    "
    :text="
      $formatMessage({
        defaultMessage:
          'Sign in online once on this device, then download books to read them offline.',
        id: '7lb85t',
        description: 'Offline missing session explanation',
      })
    "
  >
    <template #actions>
      <v-btn
        to="/login"
        :text="
          $formatMessage({
            defaultMessage: 'Sign in',
            id: 'M1qH9S',
            description: 'Offline missing session action',
          })
        "
      />
    </template>
  </v-empty-state>
</template>

<route lang="yaml">
meta:
  layout: single
  noAuth: true
</route>
