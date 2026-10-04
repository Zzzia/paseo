package sh.paseo.connection

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class BackgroundConnectionService : HeadlessJsTaskService() {
  private val connectionSession = ConnectionSession()
  private var taskStarted = false

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(
      CHANNEL_ID, getString(R.string.background_connection_channel), NotificationManager.IMPORTANCE_LOW
    ))
    val notification = createNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else startForeground(NOTIFICATION_ID, notification)
    session = connectionSession
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!taskStarted) {
      taskStarted = true
      super.onStartCommand(intent, flags, startId)
    }
    // 由用户前台连接开启，系统结束后不偷偷重建运行时或第二套连接。
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig = HeadlessJsTaskConfig(
    "PaseoBackgroundConnection",
    Arguments.createMap().apply { putString("sessionId", connectionSession.id) },
    0,
    true
  )

  override fun onDestroy() {
    connectionSession.stop()
    if (session === connectionSession) session = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    // 基类释放 Headless JS 唤醒锁；JS Promise 完成后结束原运行时中的任务。
    super.onDestroy()
  }

  private fun createNotification(): Notification {
    val launch = requireNotNull(packageManager.getLaunchIntentForPackage(packageName))
    val openApp = PendingIntent.getActivity(
      this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val stop = PendingIntent.getService(
      this, 1, Intent(this, BackgroundConnectionService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.paseo_connection_notification)
      .setContentTitle(getString(R.string.background_connection_title))
      .setContentText(getString(R.string.background_connection_body))
      .setContentIntent(openApp)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .addAction(Notification.Action.Builder(
        null, getString(R.string.background_connection_stop), stop
      ).build())
      .build()
  }

  companion object {
    internal var session: ConnectionSession? = null
      private set
    private const val CHANNEL_ID = "paseo-background-connection"
    private const val NOTIFICATION_ID = 7101
    private const val ACTION_STOP = "sh.paseo.connection.STOP"
  }
}
