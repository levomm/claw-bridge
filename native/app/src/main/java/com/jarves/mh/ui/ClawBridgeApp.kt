package com.jarves.mh.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jarves.mh.data.ConnectionVault

private enum class ClawRoot(val label: String) {
    HOME("Home"), CHAT("Chat"), CODEX("Codex"), TERMINAL("Terminal"), CONNECTIONS("Connections"), SETTINGS("Settings")
}

@Composable
fun ClawBridgeApp(viewModel: MainViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Preserve the proven onboarding/runtime setup and full project workspace.
    if (state.startupStage != StartupStage.READY || state.activeProject != null) {
        PocketDevApp(viewModel)
        return
    }

    var screen by rememberSaveable { mutableStateOf(ClawRoot.HOME) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("CLAW Bridge", fontWeight = FontWeight.Bold)
                        Text("dev by osx01", fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                listOf(ClawRoot.HOME, ClawRoot.CHAT, ClawRoot.CODEX, ClawRoot.TERMINAL, ClawRoot.CONNECTIONS).forEach { item ->
                    NavigationBarItem(
                        selected = screen == item,
                        onClick = { screen = item },
                        icon = {
                            Icon(
                                when (item) {
                                    ClawRoot.HOME -> Icons.Default.Home
                                    ClawRoot.CHAT -> Icons.Default.Chat
                                    ClawRoot.CODEX -> Icons.Default.Code
                                    ClawRoot.TERMINAL -> Icons.Default.Terminal
                                    ClawRoot.CONNECTIONS -> Icons.Default.Hub
                                    ClawRoot.SETTINGS -> Icons.Default.Settings
                                },
                                item.label,
                            )
                        },
                        label = { Text(item.label, fontSize = 10.sp) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (screen) {
                ClawRoot.HOME -> ClawHome(
                    onChat = { screen = ClawRoot.CHAT },
                    onCodex = { screen = ClawRoot.CODEX },
                    onConnections = { screen = ClawRoot.CONNECTIONS },
                )
                ClawRoot.CHAT -> CodexChatScreen(viewModel)
                ClawRoot.CODEX -> CodexWorkspaceLauncher(viewModel)
                ClawRoot.TERMINAL -> PocketTerminalSurface(viewModel)
                ClawRoot.CONNECTIONS -> ConnectionsScreen(viewModel)
                ClawRoot.SETTINGS -> PocketDevApp(viewModel)
            }
        }
    }
}

@Composable
private fun ClawHome(onChat: () -> Unit, onCodex: () -> Unit, onConnections: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(20.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Your phone is the control plane", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Chat with ChatGPT/Codex, build in a full agent workspace, use the private Linux runtime, and bridge into Windows or servers.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onChat, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Icon(Icons.Default.Chat, null); Spacer(Modifier.width(8.dp)); Text("Chat")
        }
        Button(onClick = onCodex, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Icon(Icons.Default.Code, null); Spacer(Modifier.width(8.dp)); Text("Codex workspace")
        }
        OutlinedButton(onClick = onConnections, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Icon(Icons.Default.Hub, null); Spacer(Modifier.width(8.dp)); Text("Connections")
        }
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceVariant) {
            Column(Modifier.padding(16.dp)) {
                Text("Included", fontWeight = FontWeight.SemiBold)
                Text("Ubuntu PRoot · Terminal · Files · Projects · Approvals · Preview · Windows Host · Gateway", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun CodexChatScreen(viewModel: MainViewModel) {
    val lines by viewModel.terminalLines.collectAsStateWithLifecycle()
    val running by viewModel.isTerminalRunning.collectAsStateWithLifecycle()
    val live by viewModel.terminalLiveOutput.collectAsStateWithLifecycle()
    var prompt by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Chat", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Uses your ChatGPT/Codex session. Sign in once under Connections.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        Spacer(Modifier.height(10.dp))
        Surface(Modifier.weight(1f).fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(12.dp).verticalScroll(rememberScrollState())) {
                lines.takeLast(8).forEach { line ->
                    if (line.output.isNotBlank()) Text(line.output, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                }
                if (live.isNotBlank()) Text(live, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(prompt, { prompt = it }, modifier = Modifier.fillMaxWidth(), placeholder = { Text("Message ChatGPT…") }, enabled = !running)
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = {
                val clean = prompt.trim()
                if (clean.isNotBlank()) {
                    val encoded = clean.replace("'", "'\\''")
                    viewModel.runTerminalCommand("codex exec --skip-git-repo-check --sandbox read-only '$encoded'")
                    prompt = ""
                }
            },
            enabled = prompt.isNotBlank() && !running,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (running) "Thinking…" else "Send") }
    }
}

@Composable
private fun CodexWorkspaceLauncher(viewModel: MainViewModel) {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Codex workspace", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Projects keep Chat, files, terminal, changes, preview and approvals together. Existing CLAW workspace safety stays intact.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(
            onClick = { viewModel.createQuickProject() },
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Start quick workspace") }
        Text("The workspace keeps the existing project runtime while the Codex CLI connection is available independently through Chat and Terminal.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PocketTerminalSurface(viewModel: MainViewModel) {
    val lines by viewModel.terminalLines.collectAsStateWithLifecycle()
    val running by viewModel.isTerminalRunning.collectAsStateWithLifecycle()
    val live by viewModel.terminalLiveOutput.collectAsStateWithLifecycle()
    var command by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Terminal", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Ubuntu PRoot", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        Surface(Modifier.weight(1f).fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(12.dp).verticalScroll(rememberScrollState())) {
                lines.takeLast(20).forEach { line ->
                    Text("$ ${line.command}", fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    if (line.output.isNotBlank()) Text(line.output, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                }
                if (live.isNotBlank()) Text(live, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(command, { command = it }, modifier = Modifier.fillMaxWidth(), enabled = !running, placeholder = { Text("Command") })
        Button(onClick = { viewModel.runTerminalCommand(command); command = "" }, enabled = command.isNotBlank() && !running, modifier = Modifier.fillMaxWidth()) { Text("Run") }
    }
}

@Composable
private fun ConnectionsScreen(viewModel: MainViewModel) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("claw_connections", 0) }
    val vault = remember { ConnectionVault(context) }
    val running by viewModel.isTerminalRunning.collectAsStateWithLifecycle()
    val live by viewModel.terminalLiveOutput.collectAsStateWithLifecycle()
    val lines by viewModel.terminalLines.collectAsStateWithLifecycle()

    var windowsUrl by rememberSaveable { mutableStateOf(viewModel.windowsHostUrl()) }
    var windowsToken by rememberSaveable { mutableStateOf(viewModel.getSavedWindowsHostToken()) }
    var server by rememberSaveable { mutableStateOf(prefs.getString("server", "") ?: "") }
    var serverUser by rememberSaveable { mutableStateOf(prefs.getString("server_user", "") ?: "") }
    var telegramToken by rememberSaveable { mutableStateOf(vault.get("telegram_bot_token").orEmpty()) }
    var telegramChat by rememberSaveable { mutableStateOf(prefs.getString("telegram_chat", "") ?: "") }

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Connections", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)

        ConnectionCard("ChatGPT / Codex OAuth", "Shared ChatGPT login for Chat and Codex") {
            Button(
                onClick = { viewModel.runTerminalCommand("command -v codex >/dev/null 2>&1 || npm install -g @openai/codex; codex login --device-auth") },
                enabled = !running,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Connect ChatGPT / Codex") }
            OutlinedButton(
                onClick = { viewModel.runTerminalCommand("codex login status") },
                enabled = !running,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Check login") }
        }

        ConnectionCard("Windows Host", "PowerShell, files, browser and Windows UI automation") {
            OutlinedTextField(windowsUrl, { windowsUrl = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Host URL") }, placeholder = { Text("http://192.168.1.20:8765") })
            OutlinedTextField(
                windowsToken,
                { windowsToken = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Pairing token") },
                visualTransformation = PasswordVisualTransformation(),
            )
            Button(
                onClick = { viewModel.saveWindowsHost(windowsUrl, windowsToken) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save Windows Host") }
            Text("High-impact Windows actions still pass through the CLAW approval model.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        ConnectionCard("Server", "SSH into a remote Linux server") {
            OutlinedTextField(server, { server = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Host / IP") })
            OutlinedTextField(serverUser, { serverUser = it }, modifier = Modifier.fillMaxWidth(), label = { Text("User") })
            Button(
                onClick = {
                    prefs.edit().putString("server", server).putString("server_user", serverUser).apply()
                    val host = server.replace("'", "")
                    val user = serverUser.replace("'", "")
                    viewModel.runTerminalCommand("ssh -o StrictHostKeyChecking=accept-new ${if (user.isBlank()) "" else "$user@"}$host 'uname -a'")
                },
                enabled = server.isNotBlank() && !running,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save & test SSH") }
        }

        ConnectionCard("Telegram", "Send results and test the configured bot") {
            OutlinedTextField(
                telegramToken,
                { telegramToken = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Bot token") },
                visualTransformation = PasswordVisualTransformation(),
            )
            OutlinedTextField(telegramChat, { telegramChat = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Chat ID") })
            Button(
                onClick = {
                    vault.put("telegram_bot_token", telegramToken)
                    prefs.edit().putString("telegram_chat", telegramChat).apply()
                    val token = telegramToken.replace("'", "")
                    val chat = telegramChat.replace("'", "")
                    viewModel.runTerminalCommand("curl -fsS -X POST 'https://api.telegram.org/bot$token/sendMessage' --data-urlencode 'chat_id=$chat' --data-urlencode 'text=CLAW Bridge connected'")
                },
                enabled = telegramToken.isNotBlank() && telegramChat.isNotBlank() && !running,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save & test Telegram") }
            Text("Bot token is encrypted with Android Keystore.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (live.isNotBlank() || lines.lastOrNull()?.output?.isNotBlank() == true) {
            Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) {
                Text((live.ifBlank { lines.lastOrNull()?.output.orEmpty() }).takeLast(3000), Modifier.padding(12.dp), fontFamily = FontFamily.Monospace, fontSize = 11.sp)
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ConnectionCard(title: String, subtitle: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            content()
        }
    }
}
