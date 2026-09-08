package com.jarves.mh.runtime

import android.content.Context
import com.jarves.mh.data.ApiKeyVault
import com.jarves.mh.data.AppPreferences
import com.jarves.mh.data.ConnectionVault
import java.io.File
import java.io.RandomAccessFile
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
    val statusCheckRunning: Boolean = false,
    val installState: CodexInstallState = CodexInstallState.UNKNOWN,
    val authState: CodexAuthState = CodexAuthState.UNKNOWN,
    val codexPath: String? = null,
    val codexVersion: String? = null,
    val deviceAuthUrl: String? = null,
    val deviceAuthCode: String? = null,
    val deviceAuthExpiresAtMillis: Long? = null,
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
    private val statusMutex = Mutex()
    @Volatile private var authJob: Job? = null
    @Volatile private var authCancellationRequested = false

    private val _state = MutableStateFlow(ClawCodexState(chat = loadHistory()))
    val state: StateFlow<ClawCodexState> = _state.asStateFlow()

    init {
        scope.launch { watchApprovals() }
        scope.launch {
            refreshRuntimeState(showChecking = true)
            while (true) {
                delay(STATE_REFRESH_INTERVAL_MS)
                if (!_state.value.authRunning && !_state.value.chatRunning && !_state.value.workspaceRunning) {
                    refreshRuntimeState(showChecking = false)
                }
            }
        }
    }

    fun close() {
        ActiveCodexProcess.auth?.destroy()
        ActiveCodexProcess.agent?.destroy()
        scope.cancel()
    }

    fun checkLogin() {
        scope.launch { refreshRuntimeState(showChecking = true) }
    }

    fun connectChatGpt() {
        if (authJob?.isActive == true) return
        authCancellationRequested = false
        authJob = scope.launch { runDeviceAuthLifecycle() }
    }

    fun cancelLogin() {
        if (authJob?.isActive != true && !_state.value.authRunning) return
        authCancellationRequested = true
        stopAuthProcess()
        updateRuntimeState {
            it.copy(
                authRunning = false,
                authState = CodexAuthState.CANCELLED,
                deviceAuthUrl = null,
                deviceAuthCode = null,
                deviceAuthExpiresAtMillis = null,
                lastError = null,
            )
        }
    }

    private suspend fun runDeviceAuthLifecycle() {
        updateRuntimeState {
            it.copy(
                authRunning = true,
                authState = CodexAuthState.CHECKING,
                deviceAuthUrl = null,
                deviceAuthCode = null,
                deviceAuthExpiresAtMillis = null,
                lastError = null,
            )
        }

        if (!ensureCodexInstalled()) {
            updateRuntimeState { it.copy(authRunning = false) }
            return
        }

        val existingLogin = queryLoginStatus()
        if (existingLogin.connected) {
            updateRuntimeState {
                it.copy(authRunning = false, authState = CodexAuthState.CONNECTED, lastError = null)
            }
            return
        }

        val startedAt = System.currentTimeMillis()
        val defaultExpiry = startedAt + DEVICE_AUTH_TIMEOUT_MS
        updateRuntimeState {
            it.copy(
                authRunning = true,
                authState = CodexAuthState.CHECKING,
                deviceAuthExpiresAtMillis = null,
                lastError = null,
            )
        }

        val loginDeferred = scope.async {
            runCommand(
                workspace = chatDir,
                guestWorkspace = "/workspace/claw-chat",
                command = listOf(codexBinary(), "login", "--device-auth"),
                processSlot = ProcessSlot.AUTH,
            ) { live ->
                val authorization = CodexRuntimeLogic.parseDeviceAuthorization(live)
                if (authorization != null) {
                    updateRuntimeState {
                        it.copy(
                            authRunning = true,
                            authState = CodexAuthState.DEVICE_PENDING,
                            deviceAuthUrl = authorization.url,
                            deviceAuthCode = authorization.code,
                            deviceAuthExpiresAtMillis = defaultExpiry,
                            lastError = null,
                        )
                    }
                }
            }
        }

        var connected = false
        var promptTimedOut = false
        while (!loginDeferred.isCompleted && !authCancellationRequested) {
            if (System.currentTimeMillis() >= defaultExpiry) break
            delay(LOGIN_POLL_INTERVAL_MS)
            val status = queryLoginStatus()
            if (status.connected) {
                connected = true
                stopAuthProcess()
                break
            }
            if (
                CodexRuntimeLogic.devicePromptTimedOut(
                    startedAtMillis = startedAt,
                    nowMillis = System.currentTimeMillis(),
                    deviceCode = _state.value.deviceAuthCode,
                    timeoutMillis = DEVICE_AUTH_PROMPT_TIMEOUT_MS,
                )
            ) {
                promptTimedOut = true
                stopAuthProcess()
                break
            }
        }

        if (!loginDeferred.isCompleted) stopAuthProcess()
        val login = runCatching { loginDeferred.await() }
            .getOrElse { CommandResult(1, "", CodexRuntimeLogic.sanitize(it.message.orEmpty()).ifBlank { "Login process stopped" }) }
        val finalStatus = queryLoginStatus()
        connected = connected || finalStatus.connected
        val finalAuthState = when {
            connected -> CodexAuthState.CONNECTED
            authCancellationRequested -> CodexAuthState.CANCELLED
            promptTimedOut || (_state.value.deviceAuthCode == null && login.exitCode == 0) -> CodexAuthState.ERROR
            else -> CodexRuntimeLogic.nextAuthState(
                current = _state.value.authState,
                connected = false,
                nowMillis = System.currentTimeMillis(),
                expiresAtMillis = defaultExpiry,
                processFinished = true,
                processExitCode = login.exitCode,
                output = login.output,
            )
        }
        updateRuntimeState {
            it.copy(
                authRunning = false,
                authState = finalAuthState,
                deviceAuthUrl = if (finalAuthState == CodexAuthState.DEVICE_PENDING) it.deviceAuthUrl else null,
                deviceAuthCode = if (finalAuthState == CodexAuthState.DEVICE_PENDING) it.deviceAuthCode else null,
                deviceAuthExpiresAtMillis = if (finalAuthState == CodexAuthState.DEVICE_PENDING) defaultExpiry else null,
                lastError = when (finalAuthState) {
                    CodexAuthState.ERROR -> when {
                        promptTimedOut -> "Codex did not return a device login URL and code within 45 seconds."
                        _state.value.deviceAuthCode == null -> login.error ?: login.output.takeLast(1_500).ifBlank {
                            "Codex login ended before returning a device URL and code."
                        }
                        else -> login.error ?: "ChatGPT login failed"
                    }
                    else -> null
                },
            )
        }
        authCancellationRequested = false
    }

    private suspend fun ensureCodexInstalled(): Boolean {
        val existing = probeCodex()
        if (existing.installed) {
            applyProbe(existing)
            return true
        }

        updateRuntimeState {
            it.copy(installState = CodexInstallState.INSTALLING, authState = CodexAuthState.UNKNOWN, lastError = null)
        }
        val primary = runCommand(
            workspace = chatDir,
            guestWorkspace = "/workspace/claw-chat",
            command = listOf("/usr/bin/env", "bash", "-lc", CodexRuntimeCommands.PRIMARY_INSTALL),
            useAgentProxy = false,
        ) { }
        val afterPrimary = probeCodex()
        if (afterPrimary.installed) {
            applyProbe(afterPrimary)
            return true
        }

        val fallback = runCommand(
            workspace = chatDir,
            guestWorkspace = "/workspace/claw-chat",
            command = listOf("/usr/bin/env", "bash", "-lc", CodexRuntimeCommands.FALLBACK_INSTALL),
            useAgentProxy = false,
        ) { }
        val finalProbe = CodexRuntimeLogic.finalInstallProbe(
            primaryInstallExitCode = primary.exitCode,
            afterPrimaryProbe = afterPrimary,
            fallbackInstallExitCode = fallback.exitCode,
            finalProbe = probeCodex(),
        )
        if (finalProbe.installed) {
            applyProbe(finalProbe)
            return true
        }

        val detail = listOf(fallback.error, fallback.output, primary.error, primary.output)
            .firstOrNull { !it.isNullOrBlank() }
            ?.let(CodexRuntimeLogic::sanitize)
            ?.takeLast(1_500)
            ?: "Codex could not be installed"
        updateRuntimeState {
            it.copy(
                installState = CodexInstallState.ERROR,
                authState = CodexAuthState.UNKNOWN,
                codexPath = null,
                codexVersion = null,
                lastError = detail,
            )
        }
        return false
    }

    private suspend fun refreshRuntimeState(showChecking: Boolean) {
        statusMutex.withLock {
            if (_state.value.statusCheckRunning) return
            updateRuntimeState {
                it.copy(
                    statusCheckRunning = true,
                    installState = if (showChecking && it.installState != CodexInstallState.INSTALLED) CodexInstallState.CHECKING else it.installState,
                    authState = if (showChecking && !it.authRunning) CodexAuthState.CHECKING else it.authState,
                    lastError = if (showChecking) null else it.lastError,
                )
            }
            val probe = probeCodex()
            if (!probe.installed) {
                updateRuntimeState {
                    it.copy(
                        statusCheckRunning = false,
                        installState = CodexInstallState.NOT_INSTALLED,
                        authState = CodexAuthState.UNKNOWN,
                        codexPath = null,
                        codexVersion = null,
                        lastError = null,
                    )
                }
                return
            }
            val login = queryLoginStatus()
            if (login.connected) stopAuthProcess()
            updateRuntimeState {
                val auth = when {
                    login.connected -> CodexAuthState.CONNECTED
                    it.authRunning && it.authState == CodexAuthState.DEVICE_PENDING -> CodexAuthState.DEVICE_PENDING
                    else -> CodexAuthState.DISCONNECTED
                }
                it.copy(
                    statusCheckRunning = false,
                    authRunning = if (login.connected) false else it.authRunning,
                    installState = CodexInstallState.INSTALLED,
                    authState = auth,
                    codexPath = probe.path,
                    codexVersion = probe.version,
                    lastError = if (login.connected || it.authRunning) null else login.error,
                )
            }
        }
    }

    private suspend fun probeCodex(): CodexProbe {
        val installedRuntime = runCatching { installer.installedRuntime() }.getOrNull()
        val existingCandidate = installedRuntime?.rootfs?.let(::existingCodexCandidate)
        val result = runCommand(
            workspace = chatDir,
            guestWorkspace = "/workspace/claw-chat",
            command = listOf("/usr/bin/env", "bash", "-lc", CodexRuntimeCommands.PROBE),
            useAgentProxy = false,
        ) { }
        CodexRuntimeLogic.parseProbe(result.exitCode, result.output).takeIf(CodexProbe::installed)?.let { return it }

        // A manually installed npm binary can exist even when a shell lookup is affected by
        // stale login-shell state. Verify the real rootfs candidate directly before reinstalling.
        if (existingCandidate != null) {
            val direct = runCommand(
                workspace = chatDir,
                guestWorkspace = "/workspace/claw-chat",
                command = listOf(existingCandidate, "--version"),
                useAgentProxy = false,
            ) { }
            CodexRuntimeLogic.parseVersionProbe(direct.exitCode, existingCandidate, direct.output)
                .takeIf(CodexProbe::installed)
                ?.let { return it }
        }
        return CodexProbe(installed = false)
    }

    private fun existingCodexCandidate(rootfs: File): String? = CODEX_CANDIDATES.firstOrNull { guestPath ->
        val hostPath = File(rootfs, guestPath.removePrefix("/"))
        hostPath.exists() || runCatching { java.nio.file.Files.isSymbolicLink(hostPath.toPath()) }.getOrDefault(false)
    }

    private suspend fun queryLoginStatus(): LoginStatusResult {
        val result = runCommand(
            workspace = chatDir,
            guestWorkspace = "/workspace/claw-chat",
            command = listOf("/usr/bin/env", "bash", "-lc", CodexRuntimeCommands.LOGIN_STATUS),
            useAgentProxy = false,
        ) { }
        return LoginStatusResult(
            connected = CodexRuntimeLogic.parseLoginConnected(result.exitCode, result.output),
            error = result.error?.takeIf { result.exitCode != 0 && !it.contains("not logged in", ignoreCase = true) },
        )
    }

    private fun applyProbe(probe: CodexProbe) {
        updateRuntimeState {
            it.copy(
                installState = CodexInstallState.INSTALLED,
                codexPath = probe.path,
                codexVersion = probe.version,
                lastError = null,
            )
        }
    }

    private fun updateRuntimeState(transform: (ClawCodexState) -> ClawCodexState) {
        _state.update { current ->
            val next = transform(current)
            next.copy(authStatus = CodexRuntimeLogic.statusText(next.installState, next.authState, next.codexVersion))
        }
    }

    private fun codexBinary(): String = _state.value.codexPath
        ?.takeIf { it.startsWith('/') && !it.contains(Regex("\\s")) }
        ?: CODEX_BINARY

    fun clearChat() {
        _state.update { it.copy(chat = emptyList(), chatLiveOutput = "") }
        saveHistory(emptyList())
    }

    fun sendChat(message: String) {
        val clean = message.trim()
        if (clean.isBlank() || _state.value.chatRunning) return
        if (_state.value.authState != CodexAuthState.CONNECTED) {
            updateRuntimeState { it.copy(lastError = "Connect ChatGPT / Codex before starting a chat.") }
            checkLogin()
            return
        }
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
                    codexBinary(),
                    "--ask-for-approval", "never",
                    "exec",
                    "--skip-git-repo-check",
                    "--sandbox", "read-only",
                    "--json",
                    "--output-last-message", "/workspace/claw-chat/.claw-last-message.md",
                    contextPrompt,
                ),
                processSlot = ProcessSlot.AGENT,
                maxRuntimeMillis = CHAT_RUN_TIMEOUT_MS,
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
        if (_state.value.authState != CodexAuthState.CONNECTED) {
            updateRuntimeState { it.copy(lastError = "Connect ChatGPT / Codex before starting an agent task.") }
            checkLogin()
            return
        }
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
                    codexBinary(),
                    "-c", "sandbox_workspace_write.network_access=true",
                    "--ask-for-approval", "never",
                    "exec",
                    "--skip-git-repo-check",
                    "--sandbox", "workspace-write",
                    "--json",
                    "--output-last-message", "/workspace/codex-agent/.claw-last-message.md",
                    buildWorkspacePrompt(clean),
                ),
                processSlot = ProcessSlot.AGENT,
                maxRuntimeMillis = WORKSPACE_RUN_TIMEOUT_MS,
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
        ActiveCodexProcess.agent?.let { process ->
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
                // Package installation must use the Android IPv4 bridge. Without it,
                // Ubuntu PRoot cannot resolve ports.ubuntu.com on affected devices.
                useAgentProxy = true,
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
                useAgentProxy = false,
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
        processSlot: ProcessSlot = ProcessSlot.NONE,
        useAgentProxy: Boolean = true,
        maxRuntimeMillis: Long? = null,
        onOutput: (String) -> Unit,
    ): CommandResult = withContext(Dispatchers.IO) {
        if (!installer.isInstalled()) return@withContext CommandResult(1, "", "Local Linux runtime is not installed yet.")
        if (useAgentProxy) {
            if (!ensureAgentProxy()) {
                return@withContext CommandResult(1, "", "The local network bridge did not start after an automatic restart.")
            }
        }
        val runtime = installer.installedRuntime()
        val process = runCatching {
            installer.process(
                proot = runtime.proot,
                rootfs = runtime.rootfs,
                workspace = workspace,
                environment = runtimeEnvironment(useAgentProxy),
                guestCommand = command,
                guestWorkspacePath = guestWorkspace,
            )
        }.getOrElse { return@withContext CommandResult(1, "", it.message ?: "Could not start Codex") }
        when (processSlot) {
            ProcessSlot.AUTH -> ActiveCodexProcess.auth = process
            ProcessSlot.AGENT -> ActiveCodexProcess.agent = process
            ProcessSlot.NONE -> Unit
        }
        val native = process as? NativeSpawnProcess
            ?: run {
                process.destroy()
                clearActiveProcess(processSlot, process)
                return@withContext CommandResult(1, "", "Unsupported native process")
            }
        // NativeSpawn gives the child a pipe for stdin. `codex exec` treats any piped stdin
        // as additional context and waits for EOF before starting. Every controller command
        // is non-interactive, so close the pipe immediately instead of deadlocking the run.
        runCatching { process.outputStream.close() }
        var offset = 0L
        val captured = StringBuilder()
        val startedAt = System.currentTimeMillis()
        var timedOut = false
        try {
            while (process.isAlive || native.outputFile.length() > offset) {
                if (maxRuntimeMillis != null && System.currentTimeMillis() - startedAt >= maxRuntimeMillis && process.isAlive) {
                    timedOut = true
                    process.destroy()
                    delay(750)
                    if (process.isAlive) process.destroyForcibly()
                }
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
                    onOutput(CodexRuntimeLogic.sanitize(captured.toString()).takeLast(MAX_LIVE_OUTPUT))
                }
            }
            val exit = process.waitFor()
            // Always read the completed capture once more. Very short commands such as
            // `codex --version` can exit between the isAlive and file-length checks.
            val finalCapture = runCatching { native.outputFile.readText() }.getOrDefault(captured.toString())
            val output = CodexRuntimeLogic.sanitize(finalCapture).trim()
            val error = when {
                timedOut -> "Codex did not respond before the run timed out."
                exit == 0 -> null
                else -> output.takeLast(2000).ifBlank { "Codex exited with code $exit" }
            }
            CommandResult(if (timedOut) 124 else exit, output, error)
        } finally {
            clearActiveProcess(processSlot, process)
            runCatching { process.outputStream.close() }
            native.outputFile.delete()
        }
    }

    private fun clearActiveProcess(slot: ProcessSlot, process: Process) {
        when (slot) {
            ProcessSlot.AUTH -> if (ActiveCodexProcess.auth === process) ActiveCodexProcess.auth = null
            ProcessSlot.AGENT -> if (ActiveCodexProcess.agent === process) ActiveCodexProcess.agent = null
            ProcessSlot.NONE -> Unit
        }
    }

    private fun stopAuthProcess() {
        val process = ActiveCodexProcess.auth ?: return
        runCatching { process.destroy() }
        scope.launch {
            delay(750)
            if (process.isAlive) runCatching { process.destroyForcibly() }
        }
    }

    private suspend fun ensureAgentProxy(): Boolean {
        GatewayService.start(appContext)
        if (waitForAgentProxy(AGENT_PROXY_FIRST_WAIT_MS)) return true
        GatewayService.restart(appContext)
        return waitForAgentProxy(AGENT_PROXY_RESTART_WAIT_MS)
    }

    private suspend fun waitForAgentProxy(timeoutMillis: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            val ready = runCatching {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress("127.0.0.1", AGENT_PROXY_PORT), 300)
                }
                true
            }.getOrDefault(false)
            if (ready) return true
            delay(150)
        }
        return false
    }

    private fun runtimeEnvironment(useAgentProxy: Boolean): Map<String, String> = buildMap {
        put("PATH", CodexRuntimeCommands.GUEST_PATH)
        put("CLAW_APPROVAL_DIR", "/pocket-bridge")
        if (useAgentProxy) {
            put("HTTP_PROXY", "http://127.0.0.1:8788")
            put("HTTPS_PROXY", "http://127.0.0.1:8788")
            put("http_proxy", "http://127.0.0.1:8788")
            put("https_proxy", "http://127.0.0.1:8788")
            put("NO_PROXY", "127.0.0.1,localhost,::1")
            put("no_proxy", "127.0.0.1,localhost,::1")
        }

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
    private data class LoginStatusResult(val connected: Boolean, val error: String?)
    private enum class ProcessSlot { NONE, AUTH, AGENT }

    private object ActiveCodexProcess {
        @Volatile var auth: Process? = null
        @Volatile var agent: Process? = null
    }

    companion object {
        private const val CODEX_BINARY = "/usr/local/bin/codex"
        private val CODEX_CANDIDATES = listOf("/usr/local/bin/codex", "/usr/bin/codex", "/bin/codex")
        private const val LOGIN_POLL_INTERVAL_MS = 2_000L
        private const val DEVICE_AUTH_PROMPT_TIMEOUT_MS = 45_000L
        private const val DEVICE_AUTH_TIMEOUT_MS = 15L * 60L * 1_000L
        private const val AGENT_PROXY_PORT = 8788
        private const val AGENT_PROXY_FIRST_WAIT_MS = 3_000L
        private const val AGENT_PROXY_RESTART_WAIT_MS = 7_000L
        private const val CHAT_RUN_TIMEOUT_MS = 5L * 60L * 1_000L
        private const val WORKSPACE_RUN_TIMEOUT_MS = 45L * 60L * 1_000L
        private const val STATE_REFRESH_INTERVAL_MS = 15_000L
        private const val MAX_CHAT_ENTRIES = 40
        private const val MAX_WORKSPACE_LOG = 60
        private const val MAX_LIVE_OUTPUT = 12_000
    }
}
