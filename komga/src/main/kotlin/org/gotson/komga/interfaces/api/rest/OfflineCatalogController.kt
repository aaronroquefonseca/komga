package org.gotson.komga.interfaces.api.rest

import com.fasterxml.jackson.databind.ObjectMapper
import org.gotson.komga.domain.model.SearchContext
import org.gotson.komga.infrastructure.security.KomgaPrincipal
import org.gotson.komga.infrastructure.web.cachePrivate
import org.gotson.komga.interfaces.api.persistence.BookDtoRepository
import org.gotson.komga.interfaces.api.persistence.SeriesDtoRepository
import org.gotson.komga.interfaces.api.rest.dto.restrictUrl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.security.MessageDigest
import java.util.HexFormat

data class OfflineCatalogManifest(
  val books: Map<String, String>,
  val series: Map<String, String>,
)

@RestController
@RequestMapping("api/v1/offline/catalog")
class OfflineCatalogController(
  private val books: BookDtoRepository,
  private val series: SeriesDtoRepository,
  private val mapper: ObjectMapper,
) {
  @GetMapping
  fun manifest(
    @AuthenticationPrincipal principal: KomgaPrincipal,
  ): ResponseEntity<OfflineCatalogManifest> {
    val context = SearchContext(principal.user)
    val manifest = OfflineCatalogManifest(books.findOfflineRevisions(context).mapValues { "${it.value}:${principal.user.isAdmin}" }, series.findOfflineRevisions(context).mapValues { "${it.value}:${principal.user.isAdmin}" })
    // Roles affect URL redaction even when the underlying library is unchanged.
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(
      principal.user.roles
        .sorted()
        .toString()
        .toByteArray(),
    )
    val revision = HexFormat.of().formatHex(digest.digest(mapper.writeValueAsBytes(manifest)))
    return ResponseEntity
      .ok()
      .cacheControl(cachePrivate)
      .eTag(revision)
      .body(manifest)
  }

  @PostMapping("books")
  fun books(
    @AuthenticationPrincipal principal: KomgaPrincipal,
    @RequestBody ids: List<String>,
  ) = books.findAllByIds(SearchContext(principal.user), bounded(ids)).map { it.restrictUrl(!principal.user.isAdmin) }

  @PostMapping("series")
  fun series(
    @AuthenticationPrincipal principal: KomgaPrincipal,
    @RequestBody ids: List<String>,
  ) = series.findAllByIds(SearchContext(principal.user), bounded(ids)).map { it.restrictUrl(!principal.user.isAdmin) }

  private fun bounded(ids: List<String>): List<String> {
    if (ids.size > 200) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "At most 200 catalog entries per request")
    return ids.distinct()
  }
}
