package com.jarves.mh.runtime

import android.content.Context
import com.jarves.mh.data.ApiKeyVault
import com.jarves.mh.data.AppPreferences
import com.jarves.mh.data.ConnectionVault
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class ClawChatEntry(
    val id: String = UUID.randomUUID().toString(),
    val fromUser: Boolean,
    val text: String,
    val createdAt: Long = System.currentTimeMillis(),
)

data class ClawApprovalRequest(
    val id: String,
    val toolName: String,
    val description: String,
    val command: String? = null,
    val path: String? = null,
)

data class ClawCodexState(
    val authStatus: String = "Not checked",
    val authRunning: Boolean = false,
    val chatRunning: Boolean = false,
    val workspaceRunning: Boolean = false,
    val chatLiveOutput: String = "",
    val workspaceLiveOutput: String = "",
    val chat: List<ClawChatEntry> = emptyList(),
    val workspaceLog: List<String> = emptyList(),
    val approvals: List<ClawApprovalRequest> = emptyList(),
    val lastError: String? = null,
)

/**
 * Native controller for the ChatGPT/Codex side of CLAW Bridge.
 *
 * Chat deliberately runs Codex in read-only mode. The separate Codex workspace
 * runs in workspace-write mode with network access enabled for builds. Remote
 * Windows/server actions still go through the CLAW approval bridge.
 */
class ClawCodexController(context: Context) {
    private val appContext = context.applicationContext
    private val installer = RuntimeInstaller(appContext)
    private val appPreferences = AppPreferences(appContext)
    private val apiVault = ApiKeyVault(appContext)
    private val connectionVault = ConnectionVault(appContext)
    private val connectionPreferences = appContext.getSharedPreferences("claw_connections", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val chatDir = File(appContext.filesDir, "workspaces/claw-chat").apply { mkdirs() }
    private val workspaceDir = File(appContext.filesDir, "workspaces/codex-agent").apply { mkdirs() }
    private val historyFile = File(appContext.filesDir, "claw-chat-history.json")
    private val bridgeDir = File(appContext.filesDir, "runtime-bridge").apply { mkdirs() }
    private val seenApprovals = mutableSetOf<String>()

    private val _state = MutableStateFlow(ClawCodexState(chat = loadHistory()))
    val state: StateFlow<ClawCodexState> = _state.asStateFlow()

    init {
        scope.launch { watchApprovals() }
    }

    fun close() {
        scope.cancel()
    }

    fun checkLogin() {
        if (_state.value.authRunning) return
        _state.update { it.copy(authRunning = true, authStatus = "Checking ChatGPT login…", lastError = null) }
        scope.launch {
            val result = runCommand(
                workspace = chatDir,
                guestWorkspace = "/workspace/claw-chat",
                command = listOf("/usr/bin/env", "bash", "-lc", "command -v codex >/dev/null 2>&1 && codex login status || { echo 'Codex is not installed'; exit 127; }")
            ) { live -> _state.update { it.copy(authStatus = live.takeLast(1200)) } }
            _state.update {
                it.copy(
                    authRunning = false,
                    authStatus = result.output.ifBlank { if (result.exitCode == 0) "Connected" else "Not connected" }.takeLast(2000),
                    lastError = result.error,
                )
            }
        }
    }

    fun connectChatGpt() {
        if (_state.value.authRunning) return
        _state.update { it.copy(authRunning = true, authStatus = "Preparing Codex…", lastError = null) }
        scope.launch {
            val install = runCommand(
                workspace = chatDir,
                guestWorkspace = "/workspace/claw-chat",
                command = listOf(
                    "/usr/bin/env", "bash", "-lc",
                    "command -v codex >/dev/null 2>&1 || npm install -g @openai/codex"
                ),
            ) { live -> _state.update { it.copy(authStatus = live.takeLast(1200)) } }
            if (install.exitCode != 0) {
                _state.update { it.copy(authRunning = false, authStatus = "Codex install failed", lastError = install.error ?: install.output) }
                return@launch
            }
            val login = runCommand(
                workspace = chatDir,
                guestWorkspace = "/workspace/claw-chat",
                command = listOf("codex", "login", "--device-auth"),
            ) { live -> _state.update { it.copy(authStatus = live.takeLast(2400)) } }
            _state.update {
                it.copy(
                    authRunning = false,
                    authStatus = login.output.ifBlank { if (login.exitCode == 0) "ChatGPT connected" else "Login stopped" }.takeLast(3000),
                    lastError = login.error,
                )
            }
        }
    }

    fun clearChat() {
        _state.update { it.copy(chat = emptyList(), chatLiveOutput = "") }
        saveHistory(emptyList())
    }

    fun sendChat(message: String) {
        val clean = message.trim()
        if (clean.isBlank() || _state.value.chatRunning) return
        val userEntry = ClawChatEntry(fromUser = true, text = clean)
        val updatedHistory = (_state.value.chat + userEntry).takeLast(MAX_CHAT_ENTRIES)
        _state.update { it.copy(chat = updatedHistory, chatRunning = true, chatLiveOutput = "Starting Codex…", lastError = null) }
        saveHistory(updatedHistory)

        scope.launch {
            val lastMessage = File(chatDir, ".claw-last-message.md").apply { delete() }
            val contextPrompt = buildChatPrompt(updatedHistory)
            val result = runCommand(
                workspace = chatDir,
                guestWorkspace = "/workspace/claw-chat",
                command = listOf(
                    "codex",
                    "--ask-for-approval", "never",
                    "exec",
                    "--skip-git-repo-check",
                    "--sandbox", "read-only",
                    "--json",
                    "--output-last-message", "/workspace/claw-chat/.claw-last-message.md",
                    contextPrompt,
                ),
            ) { live -> _state.update { it.copy(chatLiveOutput = summarizeCodexStream(live)) } }

            val answer = lastMessage.takeIf(File::isFile)?.readText()?.trim()
                .orEmpty()
                .ifBlank { extractLastAgentMessage(result.output) }
                .ifBlank { result.error ?: "Codex returned no message." }
            val assistantEntry = ClawChatEntry(fromUser = false, text = answer)
            _state.update {
                val finalHistory = (it.chat + assistantEntry).takeLast(MAX_CHAT_ENTRIES)
                saveHistory(finalHistory)
                it.copy(
                    chat = finalHistory,
                    chatRunning = false,
                    chatLiveOutput = "",
                    lastError = result.error.takeIf { result.exitCode != 0 },
                )
            }
        }
    }

    fun runWorkspaceTask(task: String) {
        val clean = task.trim()
        if (clean.isBlank() || _state.value.workspaceRunning) return
        _state.update {
            it.copy(
                workspaceRunning = true,
                workspaceLiveOutput = "Starting Codex workspace…",
                workspaceLog = (it.workspaceLog + "> $clean").takeLast(MAX_WORKSPACE_LOG),
                lastError = null,
            )
        }
        scope.launch {
            val lastMessage = File(workspaceDir, ".claw-last-message.md").apply { delete() }
            val result = runCommand(
                workspace = workspaceDir,
                guestWorkspace = "/workspace/codex-agent",
                command = listOf(
                    "codex",
                    "-c", "sandbox_workspace_write.network_access=true",
                    "--ask-for-approval", "never",
                    "exec",
                    "--skip-git-repo-check",
                    "--sandbox", "workspace-write",
                    "--json",
                    "--output-last-message", "/workspace/codex-agent/.claw-last-message.md",
                    buildWorkspacePrompt(clean),
                ),
            ) { live -> _state.update { it.copy(workspaceLiveOutput = summarizeCodexStream(live)) } }
            val answer = lastMessage.takeIf(File::isFile)?.readText()?.trim()
                .orEmpty()
                .ifBlank { extractLastAgentMessage(result.output) }
                .ifBlank { result.error ?: "Codex finished without a final message." }
            _state.update {
                it.copy(
                    workspaceRunning = false,
                    workspaceLiveOutput = "",
                    workspaceLog = (it.workspaceLog + answer).takeLast(MAX_WORKSPACE_LOG),
                    lastError = result.error.takeIf { result.exitCode != 0 },
                )
            }
        }
    }

    fun stopActiveRun() {
        ActiveCodexProcess.process?.let { process ->
            runCatching { process.destroy() }
            scope.launch {
                delay(500)
                if (process.isAlive) runCatching { process.destroyForcibly() }
            }
        }
    }

    fun answerApproval(id: String, allow: Boolean) {
        scope.launch {
            val response = File(bridgeDir, "$id.response")
            response.writeText(if (allow) "allow" else "deny")
            _state.update { state -> state.copy(approvals = state.approvals.filterNot { it.id == id }) }
        }
    }

    fun generateSshKey() {
        if (_state.value.workspaceRunning) return
        _state.update { it.copy(workspaceRunning = true, workspaceLiveOutput = "Preparing SSH key…") }
        scope.launch {
            val result = runCommand(
                workspace = workspaceDir,
                guestWorkspace = "/workspace/codex-agent",
                command = listOf(
                    "/usr/bin/env", "bash", "-lc",
                    "command -v ssh-keygen >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends openssh-client; }; mkdir -p /root/.ssh; chmod 700 /root/.ssh; test -f /root/.ssh/id_ed25519 || ssh-keygen -q -t ed25519 -N '' -f /root/.ssh/id_ed25519; cat /root/.ssh/id_ed25519.pub"
                ),
            ) { live -> _state.update { it.copy(workspaceLiveOutput = live.takeLast(2400)) } }
            _state.update {
                it.copy(
                    workspaceRunning = false,
                    workspaceLiveOutput = "",
                    workspaceLog = (it.workspaceLog + result.output).takeLast(MAX_WORKSPACE_LOG),
                    lastError = result.error,
                )
            }
        }
    }

    fun testServer(host: String, user: String, port: Int) {
        val cleanHost = host.trim().replace(Regex("[^A-Za-z0-9._:-]"), "")
        val cleanUser = user.trim().replace(Regex("[^A-Za-z0-9._-]"), "")
        if (cleanHost.isBlank()) return
        connectionPreferences.edit()
            .putString("server", cleanHost)
            .putString("server_user", cleanUser)
            .putInt("server_port", port.coerceIn(1, 65535))
            .apply()
        val target = if (cleanUser.isBlank()) cleanHost else "$cleanUser@$cleanHost"
        val command = "ssh -p ${port.coerceIn(1, 65535)} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 $target 'printf CLAW_SERVER_OK'"
        _state.update { it.copy(workspaceRunning = true, workspaceLiveOutput = "Testing SSH…") }
        scope.launch {
            val result = runCommand(
                workspace = workspaceDir,
                guestWorkspace = "/workspace/codex-agent",
                command = listOf("/usr/bin/env", "bash", "-lc", command),
            ) { live -> _state.update { it.copy(workspaceLiveOutput = live.takeLast(2000)) } }
            _state.update {
                it.copy(
                    workspaceRunning = false,
                    workspaceLiveOutput = "",
                    workspaceLog = (it.workspaceLog + result.output).takeLast(MAX_WORKSPACE_LOG),
                    lastError = result.error,
                )
            }
        }
    }

    private suspend fun runCommand(
        workspace: File,
        guestWorkspace: String,
        command: List<String>,
        onOutput: (String) -> Unit,
    ): CommandResult = withContext(Dispatchers.IO) {
        if (!installer.isInstalled()) return@withContext CommandResult(1, "", "Local Linux runtime is not installed yet.")
        GatewayService.start(appContext)
        val runtime = installer.installedRuntime()
        val process = runCatching {
            installer.process(
                proot = runtime.proot,
                rootfs = runtime.rootfs,
                workspace = workspace,
                environment = runtimeEnvironment(),
                guestCommand = command,
                guestWorkspacePath = guestWorkspace,
            )
        }.getOrElse { return@withContext CommandResult(1, "", it.message ?: "Could not start Codex") }
        ActiveCodexProcess.process = process
        val native = process as? NativeSpawnProcess
            ?: return@withContext CommandResult(1, "", "Unsupported native process")
        var offset = 0L
        val captured = StringBuilder()
        while (process.isAlive || native.outputFile.length() > offset) {
            val available = native.outputFile.length() - offset
            if (available <= 0L) {
                delay(60)
                continue
            }
            val bytes = ByteArray(minOf(available, 32L * 1024).toInt())
            val count = RandomAccessFile(native.outputFile, "r").use { input ->
                input.seek(offset)
                input.read(bytes)
            }
            if (count > 0) {
                offset += count
                captured.append(bytes.decodeToString(0, count))
                onOutput(sanitizeTerminalOutput(captured.toString()).takeLast(MAX_LIVE_OUTPUT))
            }
        }
        val exit = process.waitFor()
        ActiveCodexProcess.process = null
        val output = sanitizeTerminalOutput(captured.toString()).trim()
        CommandResult(exit, output, if (exit == 0) null else output.takeLast(2000).ifBlank { "Codex exited with code $exit" })
    }

    private fun runtimeEnvironment(): Map<String, String> = buildMap {
        put("CLAW_APPROVAL_DIR", "/pocket-bridge")
        put("HTTP_PROXY", "http://127.0.0.1:8788")
        put("HTTPS_PROXY", "http://127.0.0.1:8788")
        put("http_proxy", "http://127.0.0.1:8788")
        put("https_proxy", "http://127.0.0.1:8788")
        put("NO_PROXY", "127.0.0.1,localhost,::1")
        put("no_proxy", "127.0.0.1,localhost,::1")

        val windowsToken = apiVault.get(GatewayService.WINDOWS_HOST_TOKEN_KEY).orEmpty()
        if (appPreferences.windowsHostUrl.isNotBlank() && windowsToken.isNotBlank()) {
            put("CLAW_WINDOWS_URL", appPreferences.windowsHostUrl)
            put("CLAW_WINDOWS_TOKEN", windowsToken)
        }

        val serverHost = connectionPreferences.getString("server", "").orEmpty()
        if (serverHost.isNotBlank()) {
            put("CLAW_SERVER_HOST", serverHost)
            put("CLAW_SERVER_USER", connectionPreferences.getString("server_user", "").orEmpty())
            put("CLAW_SERVER_PORT", connectionPreferences.getInt("server_port", 22).toString())
        }

        connectionVault.get("telegram_bot_token")?.takeIf(String::isNotBlank)?.let {
            put("TELEGRAM_BOT_TOKEN", it)
        }
        connectionPreferences.getString("telegram_chat", "")?.takeIf(String::isNotBlank)?.let {
            put("TELEGRAM_CHAT_ID", it)
        }
    }

    private fun buildChatPrompt(history: List<ClawChatEntry>): String = buildString {
        appendLine("You are the Chat surface inside CLAW Bridge. This is conversation mode, not coding-agent mode.")
        appendLine("Answer naturally and concisely. Do not modify files or run commands. The runtime is intentionally read-only.")
        appendLine()
        history.takeLast(12).forEach { entry ->
            append(if (entry.fromUser) "User: " else "Assistant: ")
            appendLine(entry.text)
        }
        appendLine()
        append("Respond to the latest user message.")
    }

    private fun buildWorkspacePrompt(task: String): String = buildString {
        appendLine("You are Codex inside CLAW Bridge on Android. Work autonomously in /workspace/codex-agent.")
        appendLine("You may create and edit files in this workspace and run build/test commands.")
        appendLine("CLAW Bridge provides a separate approval bridge for remote Windows/server actions.")
        if (appPreferences.windowsHostUrl.isNotBlank()) {
            appendLine("A paired Windows Host exists. Use the CLAW tool bridge when Windows access is needed.")
            appendLine("Tool bridge command: node /opt/claw-gateway/claw-tool.mjs <tool-name> '<json-arguments>'")
            appendLine("Windows tools include windows_status, windows_list_files, windows_read_file, windows_write_file, windows_run_powershell, windows_open_url, windows_list_windows, windows_list_controls, windows_invoke_control, windows_set_control_value, windows_click, windows_send_keys, windows_capture_screen.")
        }
        val serverHost = connectionPreferences.getString("server", "").orEmpty()
        if (serverHost.isNotBlank()) {
            appendLine("A remote Linux server is configured. Prefer CLAW server tools over embedding credentials in commands.")
            appendLine("Server tools include server_status, server_list_files, server_read_file, server_write_file, server_run_shell.")
        }
        appendLine("Never bypass a CLAW approval request. If a remote action waits, tell the user an approval is pending on the phone.")
        appendLine()
        appendLine("Task:")
        append(task)
    }

    private suspend fun watchApprovals() {
        while (true) {
            bridgeDir.listFiles { file -> file.name.endsWith(".request") }.orEmpty().forEach { file ->
                val id = file.name.removeSuffix(".request")
                if (!seenApprovals.add(id)) return@forEach
                runCatching {
                    val json = JSONObject(file.readText())
                    val input = json.optJSONObject("tool_input") ?: JSONObject()
                    val request = ClawApprovalRequest(
                        id = id,
                        toolName = json.optString("tool_name", "CLAW action"),
                        description = input.optString("description").ifBlank { "Remote action requested" },
                        command = input.optString("command").takeIf(String::isNotBlank),
                        path = input.optString("path").takeIf(String::isNotBlank),
                    )
                    file.delete()
                    _state.update { state -> state.copy(approvals = state.approvals + request) }
                }.onFailure {
                    seenApprovals.remove(id)
                }
            }
            delay(200)
        }
    }

    private fun loadHistory(): List<ClawChatEntry> = runCatching {
        val array = JSONArray(historyFile.readText())
        (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            ClawChatEntry(
                id = item.optString("id", UUID.randomUUID().toString()),
                fromUser = item.optBoolean("fromUser"),
                text = item.optString("text"),
                createdAt = item.optLong("createdAt", System.currentTimeMillis()),
            )
        }.filter { it.text.isNotBlank() }.takeLast(MAX_CHAT_ENTRIES)
    }.getOrDefault(emptyList())

    private fun saveHistory(history: List<ClawChatEntry>) {
        runCatching {
            val array = JSONArray()
            history.takeLast(MAX_CHAT_ENTRIES).forEach { entry ->
                array.put(
                    JSONObject()
                        .put("id", entry.id)
                        .put("fromUser", entry.fromUser)
                        .put("text", entry.text)
                        .put("createdAt", entry.createdAt)
                )
            }
            historyFile.writeText(array.toString())
        }
    }

    private fun summarizeCodexStream(raw: String): String {
        val lines = raw.lineSequence().filter(String::isNotBlank).toList()
        val last = lines.takeLast(8).map { line ->
            val json = runCatching { JSONObject(line) }.getOrNull()
            when (json?.optString("type")) {
                "thread.started" -> "Session started"
                "turn.started" -> "Working…"
                "turn.completed" -> "Finishing…"
                "turn.failed", "error" -> json.optString("message").ifBlank { line }
                "item.completed" -> {
                    val item = json.optJSONObject("item")
                    when (item?.optString("type")) {
                        "agent_message" -> item.optString("text")
                        else -> line
                    }
                }
                else -> line
            }
        }
        return last.joinToString("\n").takeLast(MAX_LIVE_OUTPUT)
    }

    private fun extractLastAgentMessage(raw: String): String = raw.lineSequence().mapNotNull { line ->
        val json = runCatching { JSONObject(line) }.getOrNull() ?: return@mapNotNull null
        if (json.optString("type") != "item.completed") return@mapNotNull null
        val item = json.optJSONObject("item") ?: return@mapNotNull null
        item.optString("text").takeIf { item.optString("type") == "agent_message" && it.isNotBlank() }
    }.lastOrNull().orEmpty()

    private data class CommandResult(val exitCode: Int, val output: String, val error: String?)

    private object ActiveCodexProcess {
        @Volatile var process: Process? = null
    }

    companion object {
        private const val MAX_CHAT_ENTRIES = 40
        private const val MAX_WORKSPACE_LOG = 60
        private const val MAX_LIVE_OUTPUT = 12_000
    }
}
