package com.jarves.mh.model

/** Top-level CLAW Bridge experiences. */
enum class ClawMode(val label: String) {
    HOME("Home"),
    CHAT("Chat"),
    CODEX("Codex"),
    TERMINAL("Terminal"),
    APPROVALS("Approvals"),
    CONNECTIONS("Connections"),
    SETTINGS("Settings"),
}

enum class ConnectionKind(val title: String, val subtitle: String) {
    WINDOWS("Windows Host", "PowerShell, files, browser and Windows UI automation"),
    SERVER("Server", "SSH access for remote Linux servers"),
    TELEGRAM("Telegram", "Send tasks and receive results from Telegram"),
}

data class ServerConnection(
    val host: String = "",
    val port: Int = 22,
    val username: String = "",
    val identityFile: String = "",
)

data class TelegramConnection(
    val botToken: String = "",
    val chatId: String = "",
)

enum class AgentSurface {
    CHAT,
    CODEX,
}
