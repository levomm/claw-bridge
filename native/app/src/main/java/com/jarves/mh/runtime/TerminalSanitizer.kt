package com.jarves.mh.runtime

private val CLAW_ANSI_SEQUENCE = Regex("\\u001B(?:\\][^\\u0007]*(?:\\u0007|\\u001B\\\\)|\\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9])")

internal fun sanitizeTerminalOutput(text: String): String = text
    .replace(CLAW_ANSI_SEQUENCE, "")
    .filter { it == '\n' || it == '\r' || it == '\t' || it.code >= 0x20 }
