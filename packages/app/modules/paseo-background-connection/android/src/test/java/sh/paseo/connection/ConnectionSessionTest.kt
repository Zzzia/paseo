package sh.paseo.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ConnectionSessionTest {
  @Test fun stoppingResolvesEveryWaiterExactlyOnce() {
    val session = ConnectionSession()
    var resolved = 0
    session.waitForStop { resolved++ }
    session.waitForStop { resolved++ }
    assertEquals(0, resolved)
    session.stop()
    session.stop()
    assertEquals(2, resolved)
  }

  @Test fun stoppingBeforeJsTaskRegistersStillCompletesTheTask() {
    val session = ConnectionSession()
    session.stop()
    var resolved = 0
    session.waitForStop { resolved++ }
    assertEquals(1, resolved)
  }

  @Test fun restartHasIndependentSessionAndWaiters() {
    val first = ConnectionSession()
    val second = ConnectionSession()
    assertNotEquals(first.id, second.id)
    var completed = 0
    second.waitForStop { completed++ }
    first.stop()
    assertEquals(0, completed)
    second.stop()
    assertEquals(1, completed)
  }
}
