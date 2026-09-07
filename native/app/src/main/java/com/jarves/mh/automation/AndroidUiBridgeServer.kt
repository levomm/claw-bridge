package com.jarves.mh.automation

import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.concurrent.Executors
import org.json.JSONObject

class AndroidUiBridgeServer(private val auditFile: File) {
    private var serverSocket: ServerSocket? = null
    private val executor = Executors.newCachedThreadPool()

    fun start(port: Int = 8791) {
        if (serverSocket != null) return
        val socket = ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"))
        serverSocket = socket
        executor.execute {
            while (!socket.isClosed) {
                runCatching { socket.accept() }.onSuccess { client -> executor.execute { handle(client) } }
            }
        }
    }

    fun stop() {
        runCatching { serverSocket?.close() }
        serverSocket = null
        executor.shutdownNow()
    }

    private fun handle(client: Socket) = client.use { socket ->
        socket.soTimeout = 5000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8))
        val requestLine = reader.readLine() ?: return
        var contentLength = 0
        while (true) {
            val line = reader.readLine() ?: return
            if (line.isEmpty()) break
            if (line.startsWith("Content-Length:", ignoreCase = true)) {
                contentLength = line.substringAfter(':').trim().toIntOrNull() ?: 0
            }
        }
        val body = CharArray(contentLength.coerceIn(0, 65536))
        var offset = 0
        while (offset < body.size) {
            val read = reader.read(body, offset, body.size - offset)
            if (read <= 0) break
            offset += read
        }

        val response = runCatching {
            require(requestLine.startsWith("POST /action ")) { "Use POST /action" }
            val payload = JSONObject(String(body, 0, offset))
            val action = payload.getString("action")
            val input = payload.optJSONObject("input") ?: JSONObject()
            val result = AndroidUiAutomation.execute(action, input)
            appendAudit(action, input, true, null)
            JSONObject().put("ok", true).put("result", result)
        }.getOrElse { error ->
            appendAudit("error", JSONObject(), false, error.message)
            JSONObject().put("ok", false).put("error", error.message ?: error.javaClass.simpleName)
        }

        val bytes = response.toString().toByteArray(StandardCharsets.UTF_8)
        val out = socket.getOutputStream()
        out.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    @Synchronized
    private fun appendAudit(action: String, input: JSONObject, ok: Boolean, error: String?) {
        auditFile.parentFile?.mkdirs()
        val entry = JSONObject()
            .put("time", Instant.now().toString())
            .put("action", action)
            .put("ok", ok)
            .put("input", redact(input))
        if (error != null) entry.put("error", error)
        auditFile.appendText(entry.toString() + "\n")
    }

    private fun redact(input: JSONObject): JSONObject {
        val copy = JSONObject(input.toString())
        if (copy.has("value")) copy.put("value", "<redacted>")
        return copy
    }
}
