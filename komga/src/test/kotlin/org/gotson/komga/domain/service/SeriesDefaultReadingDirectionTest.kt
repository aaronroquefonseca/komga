package org.gotson.komga.domain.service

import org.assertj.core.api.Assertions.assertThat
import org.gotson.komga.domain.model.Library
import org.gotson.komga.domain.model.SeriesMetadata
import org.gotson.komga.domain.model.makeSeries
import org.gotson.komga.domain.persistence.LibraryRepository
import org.gotson.komga.domain.persistence.SeriesMetadataRepository
import org.gotson.komga.domain.persistence.SeriesRepository
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.net.URL

@SpringBootTest
class SeriesDefaultReadingDirectionTest(
  @Autowired private val seriesLifecycle: SeriesLifecycle,
  @Autowired private val seriesRepository: SeriesRepository,
  @Autowired private val seriesMetadataRepository: SeriesMetadataRepository,
  @Autowired private val libraryRepository: LibraryRepository,
) {
  @AfterEach
  fun cleanup() {
    seriesLifecycle.deleteMany(seriesRepository.findAll())
    libraryRepository.deleteAll()
  }

  @Test
  fun `given library default reading direction when creating series then series inherits it unlocked`() {
    val library =
      Library(
        name = "Manga",
        root = URL("file:/manga"),
        defaultReadingDirection = SeriesMetadata.ReadingDirection.RIGHT_TO_LEFT,
      )
    libraryRepository.insert(library)

    val series = seriesLifecycle.createSeries(makeSeries("Series", libraryId = library.id))
    val metadata = seriesMetadataRepository.findById(series.id)

    assertThat(metadata.readingDirection).isEqualTo(SeriesMetadata.ReadingDirection.RIGHT_TO_LEFT)
    assertThat(metadata.readingDirectionLock).isFalse()
  }

  @Test
  fun `given no library default reading direction when creating series then reading direction stays unset`() {
    val library = Library(name = "Comics", root = URL("file:/comics"))
    libraryRepository.insert(library)

    val series = seriesLifecycle.createSeries(makeSeries("Series", libraryId = library.id))
    val metadata = seriesMetadataRepository.findById(series.id)

    assertThat(metadata.readingDirection).isNull()
    assertThat(metadata.readingDirectionLock).isFalse()
  }
}
