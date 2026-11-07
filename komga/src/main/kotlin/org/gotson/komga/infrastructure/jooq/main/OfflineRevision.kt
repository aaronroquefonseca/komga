package org.gotson.komga.infrastructure.jooq.main

import java.security.MessageDigest
import java.util.HexFormat

/** Uses database timestamps at their full precision, including user-specific progress. */
internal fun offlineRevision(vararg values: Any?): String =
  HexFormat.of().formatHex(
    MessageDigest
      .getInstance("SHA-256")
      .digest(values.joinToString("\u0000") { it?.toString() ?: "" }.toByteArray(Charsets.UTF_8)),
  )
