package sh.paseo.files

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedRef
import java.nio.channels.FileChannel
import java.util.concurrent.ConcurrentHashMap

class PaseoFileActionsModule : Module() {
  private val writers = ConcurrentHashMap<String, BackgroundFileWriter>()

  override fun definition() = ModuleDefinition {
    Name("PaseoFileActions")

    Function("createWriter") { id: String, handle: SharedRef<FileChannel> ->
      check(!writers.containsKey(id)) { "Download writer already exists: $id" }
      val channel = requireNotNull(handle.ref) { "Download file handle is unavailable" }
      writers[id] = BackgroundFileWriter(id, channel) { writers.remove(id) }
    }

    // 入队后立即返回，避免逐块 Promise 的回调被大量接收帧拖延。
    Function("writeChunk") { id: String, bytes: ByteArray ->
      requireWriter(id).write(bytes)
    }

    AsyncFunction("finishWriter") { id: String, promise: Promise ->
      requireWriter(id).finish { error -> settle(promise, error) }
    }

    AsyncFunction("abortWriter") { id: String, promise: Promise ->
      val writer = writers[id]
      if (writer == null) promise.resolve()
      else writer.abort { error -> settle(promise, error) }
    }

    OnDestroy {
      writers.values.forEach { writer ->
        writer.abort { error ->
          if (error != null) Log.e("PaseoFileActions", "Closing download writer failed", error)
        }
      }
    }

    AsyncFunction("openFile") { uri: String, mimeType: String, fileName: String ->
      val contentUri = Uri.parse(uri)
      require(contentUri.scheme == "content") { "Opening $fileName requires a content URI" }
      require(mimeType.isNotBlank()) { "Opening $fileName requires a MIME type" }
      val activity = appContext.throwingActivity
      // 未知类型由用户选应用；已知类型保留准确 MIME，交给系统匹配播放器或安装器。
      val viewType = if (mimeType == "application/octet-stream") "*/*" else mimeType
      val view = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, viewType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      if (view.resolveActivity(activity.packageManager) == null) {
        throw ActivityNotFoundException("No application can open $fileName ($mimeType)")
      }
      // 启动后即返回，不把文件按钮锁定到外部应用退出。
      activity.startActivity(Intent.createChooser(view, fileName))
    }.runOnQueue(Queues.MAIN)
  }

  private fun requireWriter(id: String): BackgroundFileWriter =
    requireNotNull(writers[id]) { "Download writer is unavailable: $id" }

  private fun settle(promise: Promise, error: Throwable?) {
    if (error == null) promise.resolve()
    else promise.reject("ERR_DOWNLOAD_WRITE", error.message, error)
  }
}
