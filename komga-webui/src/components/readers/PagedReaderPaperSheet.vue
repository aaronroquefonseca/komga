<template>
  <div class="paper-sheet" aria-hidden="true">
    <div
      v-for="tile in tiles"
      :key="`paper-tile-${tile.row}-${tile.column}`"
      class="paper-tile"
      :style="tileStyle(tile.row, tile.column)"
    >
      <div class="paper-tile-face paper-tile-front">
        <div class="paper-tile-content" :style="tileContentStyle(tile.row, tile.column)">
          <paged-reader-spread
            :spread="frontSpread"
            :flip-direction="flipDirection"
            :scale="scale"
          />
        </div>
      </div>

      <div class="paper-tile-face paper-tile-back">
        <div class="paper-tile-content" :style="tileContentStyle(tile.row, tile.column)">
          <paged-reader-spread
            :spread="backSpread"
            :flip-direction="flipDirection"
            :scale="scale"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import PagedReaderSpread from '@/components/readers/PagedReaderSpread.vue'
import {PageDtoWithUrl} from '@/types/komga-books'
import {ScaleType} from '@/types/enum-reader'
import {PageCurlVariant, paperCurlTilePhase} from '@/functions/paged-reader-transition'

type PaperTile = {
  row: number
  column: number
}

export default Vue.extend({
  name: 'PagedReaderPaperSheet',
  components: {PagedReaderSpread},
  props: {
    frontSpread: {
      type: Array as () => PageDtoWithUrl[],
      required: true,
    },
    backSpread: {
      type: Array as () => PageDtoWithUrl[],
      required: true,
    },
    flipDirection: {
      type: Boolean,
      required: true,
    },
    scale: {
      type: String as () => ScaleType,
      required: true,
    },
    progress: {
      type: Number,
      required: true,
    },
    physicalDirection: {
      type: Number,
      required: true,
    },
    variant: {
      type: String as () => PageCurlVariant,
      required: true,
    },
  },
  data: () => ({
    columns: 12,
    rows: 4,
  }),
  computed: {
    tiles(): PaperTile[] {
      const result: PaperTile[] = []
      for (let row = 0; row < this.rows; row++) {
        for (let column = 0; column < this.columns; column++) {
          result.push({row, column})
        }
      }
      return result
    },
  },
  methods: {
    tileStyle(row: number, column: number): Record<string, string> {
      const direction = Math.sign(this.physicalDirection || -1)
      const columnCenter = (column + 0.5) / this.columns
      const rowCenter = (row + 0.5) / this.rows
      const distanceFromFreeEdge = direction < 0 ? 1 - columnCenter : columnCenter
      const phase = paperCurlTilePhase(
        this.progress,
        distanceFromFreeEdge,
        rowCenter,
        this.variant,
      )

      const freeEdgeWeight = 1 - distanceFromFreeEdge
      const touchedCornerWeight = this.variant === 'top'
        ? 1 - rowCenter
        : this.variant === 'bottom'
          ? rowCenter
          : 0
      const arch = Math.sin(phase * Math.PI)

      // Almost a complete half-turn: after 90deg the back face (the target
      // spread) becomes visible, so the physical sheet never turns blank.
      const rotationY = direction * phase * 178
      const lift = arch * (28 + 62 * freeEdgeWeight)

      // Corner modes are intentionally pronounced. The touched corner bends
      // toward the centre of the book while the opposite corner remains flat
      // until much later in the gesture.
      const cornerStrength = touchedCornerWeight * freeEdgeWeight
      const rotationZ = this.variant === 'top'
        ? -direction * phase * cornerStrength * 30
        : this.variant === 'bottom'
          ? direction * phase * cornerStrength * 30
          : 0
      const verticalShiftVh = this.variant === 'top'
        ? phase * cornerStrength * 12
        : this.variant === 'bottom'
          ? -phase * cornerStrength * 12
          : 0

      const originEdge = direction < 0 ? 'left' : 'right'
      const originY = this.variant === 'top'
        ? 'top'
        : this.variant === 'bottom'
          ? 'bottom'
          : 'center'

      return {
        left: `${column * 100 / this.columns}%`,
        top: `${row * 100 / this.rows}%`,
        width: `${100 / this.columns + 0.06}%`,
        height: `${100 / this.rows + 0.06}%`,
        transformOrigin: `${originEdge} ${originY}`,
        transform: `translate3d(0, ${verticalShiftVh}vh, ${lift}px) rotateZ(${rotationZ}deg) rotateY(${rotationY}deg)`,
        zIndex: `${100 + Math.round(phase * 100)}`,
        boxShadow: phase > 0
          ? `${direction * -4}px 0 ${5 + phase * 16}px rgba(0, 0, 0, ${0.10 + phase * 0.22})`
          : 'none',
      }
    },
    tileContentStyle(row: number, column: number): Record<string, string> {
      return {
        width: `${this.columns * 100}%`,
        height: `${this.rows * 100}%`,
        left: `${-column * 100}%`,
        top: `${-row * 100}%`,
      }
    },
  },
})
</script>

<style scoped>
.paper-sheet {
  position: absolute;
  inset: 0;
  overflow: visible;
  perspective: 1800px;
  transform-style: preserve-3d;
  pointer-events: none;
}

.paper-tile {
  position: absolute;
  transform-style: preserve-3d;
  will-change: transform;
}

.paper-tile-face {
  position: absolute;
  inset: 0;
  overflow: hidden;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform-style: preserve-3d;
}

.paper-tile-back {
  transform: rotateY(180deg);
}

.paper-tile-content {
  position: absolute;
}
</style>
