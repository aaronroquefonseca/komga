package org.gotson.komga.interfaces.mvc

import jakarta.servlet.ServletContext
import org.springframework.core.io.ClassPathResource
import org.springframework.core.io.Resource
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class ServiceWorkerController(
  servletContext: ServletContext,
) {
  private val serviceWorker: Resource = ClassPathResource("offline/service-worker.js")
  private val allowedScope: String = "${servletContext.contextPath}/"

  @GetMapping("/service-worker.js", produces = ["application/javascript"])
  fun serviceWorker(): ResponseEntity<Resource> =
    ResponseEntity
      .ok()
      .contentType(MediaType.parseMediaType("application/javascript"))
      .header("Cache-Control", "no-cache, no-store, must-revalidate")
      .header("Service-Worker-Allowed", allowedScope)
      .body(serviceWorker)
}
