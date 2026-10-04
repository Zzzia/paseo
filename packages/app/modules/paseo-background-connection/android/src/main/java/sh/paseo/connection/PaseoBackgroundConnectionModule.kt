package sh.paseo.connection

import android.content.Intent
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PaseoBackgroundConnectionModule : Module() {
  private var enabled = false
  private var startRequested = false

  override fun definition() = ModuleDefinition {
    Name("PaseoBackgroundConnection")
    Events("onError")

    AsyncFunction("setEnabled") { requested: Boolean ->
      enabled = requested
      if (requested) startIfVisible() else stop()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("waitForStop") { sessionId: String, promise: Promise ->
      val session = BackgroundConnectionService.session
      if (session == null || session.id != sessionId) promise.resolve(null)
      else session.waitForStop { promise.resolve(null) }
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersForeground {
      if (enabled) {
        startRequested = false
        try {
          startIfVisible()
        } catch (error: Exception) {
          sendEvent("onError", mapOf("message" to (
            "Could not resume background host connections: ${error.javaClass.simpleName}"
          )))
        }
      }
    }

    OnDestroy {
      enabled = false
      stop()
    }
  }

  private fun startIfVisible() {
    val context = appContext.reactContext as? ReactContext
      ?: throw IllegalStateException("Background connection requires an active app runtime")
    if (context.lifecycleState != LifecycleState.RESUMED) return
    if (startRequested || BackgroundConnectionService.session != null) return
    context.startForegroundService(Intent(context, BackgroundConnectionService::class.java))
    startRequested = true
  }

  private fun stop() {
    startRequested = false
    val context = appContext.reactContext ?: return
    context.stopService(Intent(context, BackgroundConnectionService::class.java))
  }
}
