package sh.paseo.files

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.WritableByteChannel
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class BackgroundFileWriterTest {
  @Test fun finishesOnlyAfterAllChunksAreWrittenInOrder() {
    val channel = TestChannel(block = true, maxWrite = 1)
    val closed = CountDownLatch(1)
    val writer = BackgroundFileWriter("ordered", channel) { closed.countDown() }
    val finished = Completion()
    try {
      writer.write(byteArrayOf(1, 2))
      channel.awaitWriting()
      writer.write(byteArrayOf(3, 4))
      writer.finish(finished::complete)
      assertFalse(finished.done.await(100, TimeUnit.MILLISECONDS))
      assertTrue(channel.isOpen)
      channel.release.countDown()
      finished.await()
      assertNull(finished.error)
      assertArrayEquals(byteArrayOf(1, 2, 3, 4), channel.bytes.toByteArray())
      assertFalse(channel.isOpen)
      assertTrue(closed.await(2, TimeUnit.SECONDS))
    } finally {
      channel.release.countDown()
      writer.abort {}
    }
  }

  @Test fun cancelsQueuedChunksAndPendingFinishWithoutClosingAnActiveWrite() {
    val channel = TestChannel(block = true)
    val writer = BackgroundFileWriter("cancelled", channel) {}
    val finished = Completion()
    val aborted = Completion()
    try {
      writer.write(byteArrayOf(1, 2))
      channel.awaitWriting()
      writer.write(byteArrayOf(3, 4))
      writer.finish(finished::complete)
      writer.abort(aborted::complete)
      finished.await()
      assertTrue(finished.error!!.message!!.contains("cancelled"))
      assertTrue(channel.isOpen)
      assertFalse(aborted.done.await(100, TimeUnit.MILLISECONDS))
      channel.release.countDown()
      aborted.await()
      assertNull(aborted.error)
      assertArrayEquals(byteArrayOf(1, 2), channel.bytes.toByteArray())
      assertFalse(channel.isOpen)
    } finally {
      channel.release.countDown()
      writer.abort {}
    }
  }

  @Test fun boundsPendingBytesWhenStorageIsBlocked() {
    val channel = TestChannel(block = true)
    val writer = BackgroundFileWriter("blocked", channel) {}
    val aborted = Completion()
    try {
      val chunk = ByteArray(256 * 1024)
      writer.write(chunk)
      channel.awaitWriting()
      repeat(31) { writer.write(chunk) }
      assertThrows(IllegalStateException::class.java) { writer.write(chunk) }
      writer.abort(aborted::complete)
      channel.release.countDown()
      aborted.await()
      assertEquals(chunk.size, channel.bytes.size())
      assertFalse(channel.isOpen)
    } finally {
      channel.release.countDown()
      writer.abort {}
    }
  }

  @Test fun reportsWriteErrorsAndClosesTheChannel() {
    val channel = TestChannel(writeError = IOException("disk full"))
    val writer = BackgroundFileWriter("failed", channel) {}
    val finished = Completion()
    writer.write(byteArrayOf(1, 2))
    writer.finish(finished::complete)
    finished.await()
    assertEquals("disk full", finished.error!!.message)
    assertFalse(channel.isOpen)
  }

  @Test fun reportsCloseErrorsInsteadOfCompletingSuccessfully() {
    val channel = TestChannel(closeError = IOException("close failed"))
    val writer = BackgroundFileWriter("close-failed", channel) {}
    val finished = Completion()
    writer.finish(finished::complete)
    finished.await()
    assertEquals("close failed", finished.error!!.cause!!.message)
  }

  private class Completion {
    val done = CountDownLatch(1)
    var error: Throwable? = null
    fun complete(failure: Throwable?) {
      error = failure
      done.countDown()
    }
    fun await() { assertTrue("Native writer did not finish", done.await(2, TimeUnit.SECONDS)) }
  }

  private class TestChannel(
    block: Boolean = false,
    private val maxWrite: Int = Int.MAX_VALUE,
    private val writeError: IOException? = null,
    private val closeError: IOException? = null,
  ) : WritableByteChannel {
    val bytes = ByteArrayOutputStream()
    val release = CountDownLatch(if (block) 1 else 0)
    private val writing = CountDownLatch(1)
    private var open = true
    fun awaitWriting() { assertTrue(writing.await(2, TimeUnit.SECONDS)) }
    override fun isOpen() = open
    override fun close() {
      open = false
      closeError?.let { throw it }
    }
    override fun write(buffer: ByteBuffer): Int {
      writing.countDown()
      if (!release.await(2, TimeUnit.SECONDS)) throw IOException("Test write was not released")
      writeError?.let { throw it }
      check(open) { "A file was closed during its active write" }
      val length = minOf(buffer.remaining(), maxWrite)
      repeat(length) { bytes.write(buffer.get().toInt()) }
      return length
    }
  }
}
