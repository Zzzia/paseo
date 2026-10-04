package sh.paseo.connection

import java.util.UUID

internal class ConnectionSession {
  val id = UUID.randomUUID().toString()
  private var stopped = false
  private val waiters = mutableListOf<() -> Unit>()

  fun waitForStop(resolve: () -> Unit) {
    synchronized(this) {
      if (!stopped) {
        waiters.add(resolve)
        return
      }
    }
    resolve()
  }

  fun stop() {
    val callbacks = synchronized(this) {
      if (stopped) return
      stopped = true
      waiters.toList().also { waiters.clear() }
    }
    callbacks.forEach { it() }
  }
}
