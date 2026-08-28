package org.gotson.komga.interfaces.api.rest

import org.assertj.core.api.Assertions.assertThat
import org.gotson.komga.domain.model.Library
import org.gotson.komga.domain.model.SeriesMetadata
import org.gotson.komga.domain.persistence.LibraryRepository
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import java.nio.file.Path

@SpringBootTest
@AutoConfigureMockMvc(printOnlyOnFailure = false)
class LibraryDefaultReadingDirectionControllerTest(
  @Autowired private val mockMvc: MockMvc,
  @Autowired private val libraryRepository: LibraryRepository,
) {
  private val route = "/api/v1/libraries"

  @AfterEach
  fun cleanup() {
    libraryRepository.deleteAll()
  }

  @Test
  @WithMockCustomUser(roles = ["ADMIN"])
  fun `given default reading direction when updating library then it is exposed by the api`(
    @TempDir tmp: Path,
  ) {
    val library = Library(name = "Manga", root = tmp.toUri().toURL())
    libraryRepository.insert(library)

    mockMvc
      .patch("$route/${library.id}") {
        contentType = MediaType.APPLICATION_JSON
        content = """{"defaultReadingDirection":"RIGHT_TO_LEFT"}"""
      }.andExpect { status { isNoContent() } }

    mockMvc
      .get("$route/${library.id}")
      .andExpect {
        status { isOk() }
        jsonPath("$.defaultReadingDirection") { value("RIGHT_TO_LEFT") }
      }
  }

  @Test
  @WithMockCustomUser(roles = ["ADMIN"])
  fun `given default reading direction when explicitly clearing it then it becomes unset`(
    @TempDir tmp: Path,
  ) {
    val library =
      Library(
        name = "Webtoons",
        root = tmp.toUri().toURL(),
        defaultReadingDirection = SeriesMetadata.ReadingDirection.WEBTOON,
      )
    libraryRepository.insert(library)

    mockMvc
      .patch("$route/${library.id}") {
        contentType = MediaType.APPLICATION_JSON
        content = """{"defaultReadingDirection":null}"""
      }.andExpect { status { isNoContent() } }

    assertThat(libraryRepository.findById(library.id).defaultReadingDirection).isNull()
  }
}
