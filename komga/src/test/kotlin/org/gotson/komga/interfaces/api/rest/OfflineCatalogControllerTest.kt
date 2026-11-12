package org.gotson.komga.interfaces.api.rest

import com.fasterxml.jackson.databind.ObjectMapper
import org.assertj.core.api.Assertions.assertThat
import org.gotson.komga.domain.model.ContentRestrictions
import org.gotson.komga.domain.model.KomgaUser
import org.gotson.komga.domain.model.ReadProgress
import org.gotson.komga.domain.model.UserRoles
import org.gotson.komga.domain.model.makeBook
import org.gotson.komga.domain.model.makeLibrary
import org.gotson.komga.domain.model.makeSeries
import org.gotson.komga.domain.persistence.BookMetadataRepository
import org.gotson.komga.domain.persistence.BookRepository
import org.gotson.komga.domain.persistence.KomgaUserRepository
import org.gotson.komga.domain.persistence.LibraryRepository
import org.gotson.komga.domain.persistence.ReadProgressRepository
import org.gotson.komga.domain.persistence.SeriesMetadataRepository
import org.gotson.komga.domain.service.BookLifecycle
import org.gotson.komga.domain.service.KomgaUserLifecycle
import org.gotson.komga.domain.service.LibraryLifecycle
import org.gotson.komga.domain.service.SeriesLifecycle
import org.gotson.komga.infrastructure.security.KomgaPrincipal
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post

@SpringBootTest
@AutoConfigureMockMvc
class OfflineCatalogControllerTest(
  @Autowired private val mvc: MockMvc,
  @Autowired private val mapper: ObjectMapper,
  @Autowired private val libraries: LibraryRepository,
  @Autowired private val libraryLifecycle: LibraryLifecycle,
  @Autowired private val users: KomgaUserRepository,
  @Autowired private val userLifecycle: KomgaUserLifecycle,
  @Autowired private val seriesLifecycle: SeriesLifecycle,
  @Autowired private val books: BookRepository,
  @Autowired private val bookLifecycle: BookLifecycle,
  @Autowired private val metadata: BookMetadataRepository,
  @Autowired private val seriesMetadata: SeriesMetadataRepository,
  @Autowired private val progress: ReadProgressRepository,
) {
  private val library = makeLibrary()
  private val reader = KomgaUser("offline@example.org", "")
  private val series = makeSeries("Series", libraryId = library.id)
  private val book = makeBook("Book", libraryId = library.id)

  @BeforeEach
  fun setup() {
    libraries.insert(library)
    users.insert(reader)
    seriesLifecycle.addBooks(seriesLifecycle.createSeries(series), listOf(book))
  }

  @AfterEach
  fun cleanup() {
    libraryLifecycle.deleteLibrary(library)
    userLifecycle.deleteUser(reader)
  }

  private fun manifest(
    account: KomgaUser = reader,
    etag: String? = null,
  ) = mvc
    .get("/api/v1/offline/catalog") {
      with(user(KomgaPrincipal(account)))
      etag?.let { header(HttpHeaders.IF_NONE_MATCH, it) }
    }.andReturn()
    .response

  @Test
  fun `unchanged catalog returns 304 and deleted entries disappear`() {
    val first = manifest()
    assertThat(first.status).isEqualTo(200)
    val etag = first.getHeader(HttpHeaders.ETAG)!!
    assertThat(manifest(etag = etag).status).isEqualTo(304)
    bookLifecycle.deleteOne(books.findByIdOrNull(book.id)!!)
    val changed = manifest(etag = etag)
    assertThat(changed.status).isEqualTo(200)
    assertThat(mapper.readTree(changed.contentAsString).path("books").has(book.id)).isFalse()
    seriesLifecycle.deleteMany(listOf(series))
    assertThat(mapper.readTree(manifest().contentAsString).path("series").has(series.id)).isFalse()
  }

  @Test
  fun `metadata and user progress change revisions without waiting for a clock tick`() {
    fun revision() =
      mapper
        .readTree(manifest().contentAsString)
        .path("books")
        .path(book.id)
        .asText()
    val original = revision()
    metadata.update(metadata.findById(book.id).copy(title = "Changed title"))
    val edited = revision()
    assertThat(edited).isNotEqualTo(original)
    val originalSeries =
      mapper
        .readTree(manifest().contentAsString)
        .path("series")
        .path(series.id)
        .asText()
    progress.save(ReadProgress(book.id, reader.id, 1, false))
    assertThat(revision()).isNotEqualTo(edited)
    assertThat(
      mapper
        .readTree(manifest().contentAsString)
        .path("series")
        .path(series.id)
        .asText(),
    ).isNotEqualTo(originalSeries)
    progress.delete(book.id, reader.id)
    assertThat(revision()).isEqualTo(edited)
  }

  @Test
  fun `manifest and entry batches apply library and content restrictions`() {
    seriesMetadata.update(seriesMetadata.findById(series.id).copy(sharingLabels = setOf("hidden")))
    for (restricted in listOf(
      reader.copy(sharedAllLibraries = false),
      reader.copy(restrictions = ContentRestrictions(labelsExclude = setOf("hidden"))),
    )) {
      val manifest = mapper.readTree(manifest(restricted).contentAsString)
      assertThat(manifest.path("books").size()).isZero()
      assertThat(manifest.path("series").size()).isZero()
      for ((kind, id) in listOf("books" to book.id, "series" to series.id)) {
        mvc
          .post("/api/v1/offline/catalog/$kind") {
            with(user(KomgaPrincipal(restricted)))
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsBytes(listOf(id))
          }.andExpect {
            status { isOk() }
            content { json("[]") }
          }
      }
    }
  }

  @Test
  fun `batch requests are bounded and role changes invalidate redacted data`() {
    for ((kind, id) in listOf("books" to book.id, "series" to series.id)) {
      mvc
        .post("/api/v1/offline/catalog/$kind") {
          with(user(KomgaPrincipal(reader)))
          contentType = MediaType.APPLICATION_JSON
          content = mapper.writeValueAsBytes(listOf(id))
        }.andExpect {
          status { isOk() }
          jsonPath("$[0].id") { value(id) }
          jsonPath("$.length()") { value(1) }
        }
    }
    val regular =
      mapper
        .readTree(manifest().contentAsString)
        .path("books")
        .path(book.id)
        .asText()
    val admin = reader.copy(roles = reader.roles + UserRoles.ADMIN)
    assertThat(
      mapper
        .readTree(manifest(admin).contentAsString)
        .path("books")
        .path(book.id)
        .asText(),
    ).isNotEqualTo(regular)
    mvc
      .post("/api/v1/offline/catalog/books") {
        with(user(KomgaPrincipal(reader)))
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsBytes(List(201) { book.id })
      }.andExpect { status { isBadRequest() } }
  }
}
