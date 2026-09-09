package com.jarves.mh.runtime

/** The single runtime truth shared by Home, Chat, Codex, Terminal and Connections. */
enum class CodexInstallState { UNKNOWN, CHECKING, INSTALLING, INSTALLED, NOT_INSTALLED, ERROR }

enum class CodexAuthState {
    UNKNOWN,
    CHECKING,
    DISCONNECTED,
    DEVICE_PENDING,
    CONNECTED,
    EXPIRED,
    CANCELLED,
    ERROR,
}

data class CodexProbe(
    val installed: Boolean,
    val path: String? = null,
    val version: String? = null,
)

data class DeviceAuthorization(
    val url: String,
    val code: String,
)

internal object CodexRuntimeCommands {
    const val GUEST_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

    val PROBE = """
        export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
        codex_path=""
        for candidate in /usr/local/bin/codex /usr/bin/codex /bin/codex; do
          if test -f "${'$'}candidate" || test -x "${'$'}candidate"; then
            codex_path="${'$'}candidate"
            break
          fi
        done
        if test -z "${'$'}codex_path"; then
          codex_path="${'$'}(command -v codex 2>/dev/null)" || exit 127
        fi
        test -n "${'$'}codex_path" || exit 127
        printf '__CLAW_CODEX_PATH__=%s\n' "${'$'}codex_path"
        "${'$'}codex_path" --version
    """

    val LOGIN_STATUS = """
        export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
        codex_path="${'$'}(command -v codex 2>/dev/null)" || exit 127
        "${'$'}codex_path" login status
    """

    const val PRIMARY_INSTALL = """
        export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
        npm install -g @openai/codex@latest --include=optional
    """

    const val FALLBACK_INSTALL = """
        export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
        npm config set prefix /usr/local
        npm install -g @openai/codex@latest --include=optional
        hash -r
    """
}

/** Pure parsing/reconciliation helpers. These are also the regression-test seam. */
internal object CodexRuntimeLogic {
    private val pathMarker = Regex("(?m)^__CLAW_CODEX_PATH__=(\\S+)\\s*$")
    private val versionPattern = Regex("(?im)\\bcodex(?:-cli)?\\s+v?([0-9]+(?:\\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?)")
    private val urlPattern = Regex("https://auth\\.openai\\.com/codex/device(?:\\?[^\\s]*)?", RegexOption.IGNORE_CASE)
    private val labelledCodePattern = Regex("(?im)(?:one[- ]time\\s+code|device\\s+code|code)\\s*[:：]\\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{2,})*)")
    private val standaloneCodePattern = Regex("(?m)^\\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{2,})+)\\s*$")
    private val secretPatterns = listOf(
        Regex("(?i)Bearer\\s+[A-Za-z0-9._~+/-]+=*"),
        Regex("(?i)\\b(?:access_token|refresh_token|id_token)\\b\\s*[:=]\\s*[\"']?[^\\s,\"']+"),
        Regex("\\bsk-[A-Za-z0-9_-]{16,}\\b"),
    )

    fun parseProbe(exitCode: Int, rawOutput: String): CodexProbe {
        val output = sanitize(rawOutput)
        val path = pathMarker.find(output)?.groupValues?.getOrNull(1)
        val version = versionPattern.find(output)?.groupValues?.getOrNull(1)
        return CodexProbe(
            installed = exitCode == 0 && !path.isNullOrBlank() && !version.isNullOrBlank(),
            path = path,
            version = version,
        )
    }

    fun parseVersionProbe(exitCode: Int, path: String, rawOutput: String): CodexProbe {
        val version = versionPattern.find(sanitize(rawOutput))?.groupValues?.getOrNull(1)
        return CodexProbe(
            installed = exitCode == 0 && path.isNotBlank() && !version.isNullOrBlank(),
            path = path.takeIf { exitCode == 0 && !version.isNullOrBlank() },
            version = version,
        )
    }

    /** Installation is decided only by the newest real probe, never by an older npm exit code. */
    fun finalInstallProbe(
        primaryInstallExitCode: Int?,
        afterPrimaryProbe: CodexProbe?,
        fallbackInstallExitCode: Int?,
        finalProbe: CodexProbe,
    ): CodexProbe {
        @Suppress("UNUSED_VARIABLE")
        val attemptsAreDiagnosticsOnly = listOf(primaryInstallExitCode, fallbackInstallExitCode, afterPrimaryProbe)
        return finalProbe
    }

    fun parseLoginConnected(exitCode: Int, rawOutput: String): Boolean {
        val output = sanitize(rawOutput).lowercase()
        if (output.contains("not logged in") || output.contains("not authenticated") || output.contains("login required")) return false
        return exitCode == 0 && (
            output.contains("logged in") ||
                output.contains("authenticated") ||
                output.contains("using chatgpt") ||
                output.contains("using an api key") ||
                output.contains("using api key")
            )
    }

    fun parseDeviceAuthorization(rawOutput: String): DeviceAuthorization? {
        val output = sanitize(rawOutput)
        val url = urlPattern.find(output)?.value ?: return null
        val code = labelledCodePattern.find(output)?.groupValues?.getOrNull(1)
            ?: standaloneCodePattern.find(output)?.groupValues?.getOrNull(1)
            ?: return null
        return DeviceAuthorization(url = url, code = code)
    }

    fun devicePromptTimedOut(startedAtMillis: Long, nowMillis: Long, deviceCode: String?, timeoutMillis: Long): Boolean =
        deviceCode.isNullOrBlank() && nowMillis - startedAtMillis >= timeoutMillis

    fun nextAuthState(
        current: CodexAuthState,
        connected: Boolean,
        nowMillis: Long,
        expiresAtMillis: Long?,
        cancelled: Boolean = false,
        processFinished: Boolean = false,
        processExitCode: Int? = null,
        output: String = "",
    ): CodexAuthState {
        if (connected) return CodexAuthState.CONNECTED
        if (cancelled) return CodexAuthState.CANCELLED
        val expiredByTime = expiresAtMillis != null && nowMillis >= expiresAtMillis
        val expiredByOutput = sanitize(output).contains("expired", ignoreCase = true)
        if (expiredByTime || expiredByOutput) return CodexAuthState.EXPIRED
        if (current == CodexAuthState.DEVICE_PENDING && !processFinished) return CodexAuthState.DEVICE_PENDING
        if (processFinished && processExitCode != null && processExitCode != 0) return CodexAuthState.ERROR
        return CodexAuthState.DISCONNECTED
    }

    fun statusText(install: CodexInstallState, auth: CodexAuthState, version: String?): String {
        val headline = when {
            install == CodexInstallState.INSTALLING -> "Installing Codex…"
            install == CodexInstallState.CHECKING -> "Checking Codex…"
            install == CodexInstallState.NOT_INSTALLED -> "Codex is not installed"
            install == CodexInstallState.ERROR -> "Codex install failed"
            auth == CodexAuthState.CONNECTED -> "Connected"
            auth == CodexAuthState.DEVICE_PENDING -> "Waiting for authorization"
            auth == CodexAuthState.CHECKING -> "Checking ChatGPT login…"
            auth == CodexAuthState.EXPIRED -> "Device code expired"
            auth == CodexAuthState.CANCELLED -> "Login cancelled"
            auth == CodexAuthState.ERROR -> "Login failed"
            install == CodexInstallState.INSTALLED -> "Not connected"
            else -> "Not checked"
        }
        return listOfNotNull(headline, version?.let { "Codex CLI $it" }).joinToString("\n")
    }

    fun extractSshPublicKey(rawOutput: String): String? = sanitize(rawOutput)
        .lineSequence()
        .map(String::trim)
        .lastOrNull { line ->
            line.startsWith("ssh-ed25519 ") && line.split(Regex("\\s+")).size >= 2
        }

    fun sanitize(raw: String): String {
        var output = sanitizeTerminalOutput(raw)
        secretPatterns.forEach { pattern -> output = output.replace(pattern, "[REDACTED]") }
        return output
    }
}
