package org.gotson.komga.interfaces.api.persistence

import org.gotson.komga.domain.model.SearchContext
import org.gotson.komga.domain.model.SeriesSearch
import org.gotson.komga.interfaces.api.rest.dto.GroupCountDto
import org.gotson.komga.interfaces.api.rest.dto.SeriesDto
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable

interface SeriesDtoRepository {
  fun findOfflineRevisions(context: SearchContext): Map<String, String>

  fun findAllByIds(
    context: SearchContext,
    ids: Collection<String>,
  ): List<SeriesDto>

  fun findByIdOrNull(
    seriesId: String,
    userId: String,
  ): SeriesDto?

  fun findAll(
    pageable: Pageable,
  ): Page<SeriesDto>

  fun findAll(
    context: SearchContext,
    pageable: Pageable,
  ): Page<SeriesDto>

  fun findAll(
    search: SeriesSearch,
    context: SearchContext,
    pageable: Pageable,
  ): Page<SeriesDto>

  fun findAllRecentlyUpdated(
    search: SeriesSearch,
    context: SearchContext,
    pageable: Pageable,
  ): Page<SeriesDto>

  fun countByFirstCharacter(
    search: SeriesSearch,
    context: SearchContext,
  ): List<GroupCountDto>
}
