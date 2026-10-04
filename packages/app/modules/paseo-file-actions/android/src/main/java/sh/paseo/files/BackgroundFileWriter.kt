package sh.paseo.files

import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.WritableByteChannel
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal class BackgroundFileWriter(
  private val id: String,
  private val channel: WritableByteChannel,
  private val onClosed: () -> Unit,
) {
  private enum class State { RECEIVING, FINISHING, ABORTING, CLOSED }
  private val lock = Any()
  // 留一个控制任务位置，使完成/取消不会被文件块塞满队列。
  private val worker = ThreadPoolExecutor(
    1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(65),
    { runnable -> Thread(runnable, "paseo-download").apply { isDaemon = true } },
  )
  private var state = State.RECEIVING
  private var pendingBytes = 0L
  private var failure: Throwable? = null
  private var finishing: ((Throwable?) -> Unit)? = null
  private val aborting = mutableListOf<(Throwable?) -> Unit>()

  fun write(bytes: ByteArray) = synchronized(lock) {
    check(state == State.RECEIVING) { "Download writer is closed: $id" }
    failure?.let { throw IOException("Writing download failed: $id", it) }
    check(worker.queue.size < 64 && pendingBytes + bytes.size <= 8 * 1024 * 1024) {
      "Download write queue is full: $id"
    }
    pendingBytes += bytes.size
    worker.execute { writeOnWorker(bytes) }
  }

  fun finish(completion: (Throwable?) -> Unit) = synchronized(lock) {
    check(state == State.RECEIVING) { "Download writer cannot finish: $id" }
    state = State.FINISHING
    finishing = completion
    worker.execute { finishOnWorker() }
  }

  fun abort(completion: (Throwable?) -> Unit) {
    val interrupted: ((Throwable?) -> Unit)?
    synchronized(lock) {
      if (state == State.CLOSED) {
        completion(null)
        return
      }
      aborting.add(completion)
      if (state == State.ABORTING) return
      state = State.ABORTING
      interrupted = finishing
      finishing = null
      // 当前块自行结束；释放所有排队字节，不能等整份文件写完才取消。
      worker.queue.clear()
      worker.execute { abortOnWorker() }
    }
    interrupted?.invoke(IOException("Download cancelled: $id"))
  }

  private fun writeOnWorker(bytes: ByteArray) {
    try {
      val shouldWrite = synchronized(lock) { state != State.ABORTING && failure == null }
      if (!shouldWrite) return
      val buffer = ByteBuffer.wrap(bytes)
      while (buffer.hasRemaining()) {
        if (channel.write(buffer) <= 0) throw IOException("Download write made no progress: $id")
      }
    } catch (error: Exception) {
      synchronized(lock) { if (failure == null) failure = error }
    } finally {
      synchronized(lock) { pendingBytes -= bytes.size }
    }
  }

  private fun finishOnWorker() {
    val closeError = closeChannel()
    val completion = synchronized(lock) {
      if (state == State.ABORTING) return
      state = State.CLOSED
      finishing.also { finishing = null }
    }
    releaseWorker()
    val error = synchronized(lock) { failure }
    if (error != null && closeError != null) error.addSuppressed(closeError)
    completion?.invoke(error ?: closeError)
  }

  private fun abortOnWorker() {
    val closeError = closeChannel()
    val completions = synchronized(lock) {
      state = State.CLOSED
      aborting.toList().also { aborting.clear() }
    }
    releaseWorker()
    completions.forEach { it(closeError) }
  }

  private fun closeChannel(): Throwable? = try {
    channel.close()
    null
  } catch (error: Exception) {
    IOException("Closing download file failed: $id", error)
  }

  private fun releaseWorker() {
    worker.shutdown()
    onClosed()
  }
}
