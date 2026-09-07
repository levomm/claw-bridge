package com.jarves.mh.runtime

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.jarves.mh.MainActivity
import com.jarves.mh.R
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

internal object GatewayProcessController {
    @Volatile var process: Process? = null
    @Volatile var lastExitCode: Int? = null

    fun stop() {
        process?.takeIf(Process::isAlive)?.destroy()
        process = null
    }
}

class GatewayService : Service() {
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(serviceJob + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            GatewayProcessController.stop()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, runningNotification("Starting local gateway…"))
        val existing = GatewayProcessController.process
        if (existing?.isAlive == true) {
            updateNotification("Gateway ready on 127.0.0.1:8787")
            return START_STICKY
        }

        scope.launch {
            runCatching {
                val installer = RuntimeInstaller(this@GatewayService)
                val runtime = installer.installedRuntime()
                val workspace = File(filesDir, "workspaces").apply { mkdirs() }
                installer.process(
                    proot = runtime.proot,
                    rootfs = runtime.rootfs,
                    workspace = workspace,
                    environment = mapOf(
                        "CLAW_NATIVE_ANDROID" to "1",
                        "CLAW_HOST" to "127.0.0.1",
                        "CLAW_PORT" to "8787",
                        "CLAW_IPV4_PROXY_PORT" to "8788",
                        "CLAW_DATA_DIR" to "/root/.openclaw",
                        "CLAW_PROJECT" to "/workspace",
                    ),
                    guestCommand = listOf("/usr/bin/env", "node", "/opt/claw-gateway/server.mjs"),
                )
            }.onSuccess { process ->
                GatewayProcessController.process = process
                GatewayProcessController.lastExitCode = null
                updateNotification("Gateway ready on 127.0.0.1:8787")
                val exitCode = process.waitFor()
                GatewayProcessController.lastExitCode = exitCode
                GatewayProcessController.process = null
                if (exitCode != 0) showFailure("Gateway stopped with exit code $exitCode")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }.onFailure { error ->
                GatewayProcessController.process = null
                showFailure(error.message ?: "Gateway could not start")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun runningNotification(detail: String) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle("CLAW Bridge runtime")
        .setContentText(detail)
        .setContentIntent(openAppIntent())
        .setOnlyAlertOnce(true)
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .addAction(0, "Stop", stopIntent())
        .build()

    private fun updateNotification(detail: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, runningNotification(detail))
    }

    private fun showFailure(detail: String) {
        val notification = NotificationCompat.Builder(this, RESULT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("CLAW gateway needs attention")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setContentIntent(openAppIntent())
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        getSystemService(NotificationManager::class.java).notify(RESULT_NOTIFICATION_ID, notification)
    }

    private fun openAppIntent() = PendingIntent.getActivity(
        this,
        201,
        Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        },
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun stopIntent() = PendingIntent.getService(
        this,
        202,
        Intent(this, GatewayService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    override fun onDestroy() {
        GatewayProcessController.stop()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.jarves.mh.START_GATEWAY"
        const val ACTION_STOP = "com.jarves.mh.STOP_GATEWAY"
        private const val CHANNEL_ID = "claw-gateway"
        private const val RESULT_CHANNEL_ID = "claw-gateway-results"
        private const val NOTIFICATION_ID = 61
        private const val RESULT_NOTIFICATION_ID = 62

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, GatewayService::class.java).setAction(ACTION_START),
            )
        }

        private fun ensureNotificationChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "CLAW gateway", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Keeps the local agent gateway available"
                },
            )
            manager.createNotificationChannel(
                NotificationChannel(RESULT_CHANNEL_ID, "CLAW gateway errors", NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
    }
}
