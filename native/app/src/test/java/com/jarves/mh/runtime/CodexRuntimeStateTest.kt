package com.jarves.mh.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CodexRuntimeStateTest {
    @Test
    fun firstInstallFailureButFallbackSuccessEndsInstalled() {
        val missing = CodexProbe(installed = false)
        val installed = CodexProbe(true, "/usr/local/bin/codex", "0.153.4")

        val final = CodexRuntimeLogic.finalInstallProbe(
            primaryInstallExitCode = 1,
            afterPrimaryProbe = missing,
            fallbackInstallExitCode = 0,
            finalProbe = installed,
        )

        assertTrue(final.installed)
        assertEquals("/usr/local/bin/codex", final.path)
        assertEquals("0.153.4", final.version)
    }

    @Test
    fun discoversCodexAtUsrLocalBin() {
        val probe = CodexRuntimeLogic.parseProbe(
            0,
            "__CLAW_CODEX_PATH__=/usr/local/bin/codex\ncodex-cli 0.153.4\n",
        )

        assertEquals(CodexProbe(true, "/usr/local/bin/codex", "0.153.4"), probe)
        assertTrue(CodexRuntimeCommands.PROBE.contains("/usr/local/bin"))
        assertTrue(CodexRuntimeCommands.PROBE.contains("command -v codex"))
    }

    @Test
    fun loginPendingTransitionsToConnected() {
        val next = CodexRuntimeLogic.nextAuthState(
            current = CodexAuthState.DEVICE_PENDING,
            connected = true,
            nowMillis = 2_000,
            expiresAtMillis = 20_000,
        )

        assertEquals(CodexAuthState.CONNECTED, next)
    }

    @Test
    fun loginTimeoutAndExpiredOutputEndExpired() {
        val timeout = CodexRuntimeLogic.nextAuthState(
            current = CodexAuthState.DEVICE_PENDING,
            connected = false,
            nowMillis = 20_000,
            expiresAtMillis = 20_000,
        )
        val cliExpiry = CodexRuntimeLogic.nextAuthState(
            current = CodexAuthState.DEVICE_PENDING,
            connected = false,
            nowMillis = 2_000,
            expiresAtMillis = 20_000,
            processFinished = true,
            processExitCode = 1,
            output = "Device code expired",
        )

        assertEquals(CodexAuthState.EXPIRED, timeout)
        assertEquals(CodexAuthState.EXPIRED, cliExpiry)
    }

    @Test
    fun connectedStatusSurvivesUiRefresh() {
        val refreshed = CodexRuntimeLogic.nextAuthState(
            current = CodexAuthState.CONNECTED,
            connected = CodexRuntimeLogic.parseLoginConnected(0, "Logged in using ChatGPT"),
            nowMillis = 5_000,
            expiresAtMillis = null,
        )

        assertEquals(CodexAuthState.CONNECTED, refreshed)
        assertEquals("Connected\nCodex CLI 0.153.4", CodexRuntimeLogic.statusText(CodexInstallState.INSTALLED, refreshed, "0.153.4"))
    }

    @Test
    fun successfulDetectionClearsStaleInstallFailure() {
        val currentProbe = CodexRuntimeLogic.parseProbe(
            0,
            "Codex install failed\n__CLAW_CODEX_PATH__=/usr/local/bin/codex\ncodex-cli 0.153.4",
        )

        assertTrue(currentProbe.installed)
        assertFalse(CodexRuntimeLogic.statusText(CodexInstallState.INSTALLED, CodexAuthState.DISCONNECTED, currentProbe.version).contains("failed"))
    }

    @Test
    fun parsesDeviceUrlAndCodeWithoutReturningSecrets() {
        val auth = CodexRuntimeLogic.parseDeviceAuthorization(
            "Open https://auth.openai.com/codex/device\nDevice code: ABCD-EFGH\naccess_token=secret-value",
        )

        assertEquals("https://auth.openai.com/codex/device", auth?.url)
        assertEquals("ABCD-EFGH", auth?.code)
        val sanitized = CodexRuntimeLogic.sanitize("Bearer abc.def.ghi refresh_token=super-secret")
        assertFalse(sanitized.contains("abc.def.ghi"))
        assertFalse(sanitized.contains("super-secret"))
        assertTrue(sanitized.contains("[REDACTED]"))
    }

    @Test
    fun failedProbeDoesNotInventInstallation() {
        val probe = CodexRuntimeLogic.parseProbe(127, "bash: codex: command not found")
        assertFalse(probe.installed)
        assertNull(probe.path)
        assertNull(probe.version)
    }
}
