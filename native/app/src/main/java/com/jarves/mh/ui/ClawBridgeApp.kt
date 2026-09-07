package com.jarves.mh.ui

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Telegram
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jarves.mh.R
import com.jarves.mh.data.ConnectionVault
import com.jarves.mh.model.ProviderKind
import com.jarves.mh.model.ProviderProfile
import com.jarves.mh.runtime.ClawCodexController
import com.jarves.mh.runtime.ClawCodexState
import com.jarves.mh.runtime.GatewayService

private enum class ClawRoot(val label: String) {
    HOME("Home"),
    CHAT("Chat"),
    CODEX("Codex"),
    TERMINAL("Terminal"),
    APPROVALS("Approvals"),
    CONNECTIONS("Connections"),
    SETTINGS("Settings"),
}

@Composable
fun ClawBridgeApp(viewModel: MainViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current

    when (state.startupStage) {
        StartupStage.CHECKING,
        StartupStage.INSTALLING,
        StartupStage.INITIALIZING,
        StartupStage.ERROR -> {
            ClawStartupScreen(state = state, onRetry = viewModel::retryStartup)
            return
        }
        StartupStage.SETUP_REQUIRED,
        StartupStage.MODEL_SETUP -> {
            PocketDevApp(viewModel)
            return
        }
        StartupStage.READY -> Unit
    }

    if (!state.backgroundSetupComplete || state.activeProject != null) {
        PocketDevApp(viewModel)
        return
    }

    val controller = remember(context) { ClawCodexController(context) }
    DisposableEffect(controller) {
        onDispose { controller.close() }
    }
    val codexState by controller.state.collectAsStateWithLifecycle()
    var screen by rememberSaveable { mutableStateOf(ClawRoot.HOME) }

    LaunchedEffect(Unit) {
        controller.checkLogin()
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            ClawTopBar(
                screen = screen,
                pendingApprovals = codexState.approvals.size,
                onApprovals = { screen = ClawRoot.APPROVALS },
                onSettings = { screen = ClawRoot.SETTINGS },
            )
        },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                listOf(
                    ClawRoot.HOME,
                    ClawRoot.CHAT,
                    ClawRoot.CODEX,
                    ClawRoot.TERMINAL,
                    ClawRoot.CONNECTIONS,
                ).forEach { item ->
                    NavigationBarItem(
                        selected = screen == item,
                        onClick = { screen = item },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                        ),
                        icon = {
                            Icon(
                                imageVector = when (item) {
                                    ClawRoot.HOME -> Icons.Default.Home
                                    ClawRoot.CHAT -> Icons.Default.Chat
                                    ClawRoot.CODEX -> Icons.Default.Code
                                    ClawRoot.TERMINAL -> Icons.Default.Terminal
                                    ClawRoot.CONNECTIONS -> Icons.Default.Hub
                                    ClawRoot.APPROVALS -> Icons.Default.Shield
                                    ClawRoot.SETTINGS -> Icons.Default.Settings
                                },
                                contentDescription = item.label,
                            )
                        },
                        label = { Text(item.label, fontSize = 9.sp, maxLines = 1) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (screen) {
                ClawRoot.HOME -> ClawHome(
                    state = state,
                    codexState = codexState,
                    onChat = { screen = ClawRoot.CHAT },
                    onCodex = { screen = ClawRoot.CODEX },
                    onApprovals = { screen = ClawRoot.APPROVALS },
                    onConnections = { screen = ClawRoot.CONNECTIONS },
                )
                ClawRoot.CHAT -> ClawChatScreen(controller, codexState)
                ClawRoot.CODEX -> ClawCodexScreen(viewModel, controller, codexState)
                ClawRoot.TERMINAL -> ClawTerminalScreen(viewModel)
                ClawRoot.APPROVALS -> ClawApprovalsScreen(controller, codexState)
                ClawRoot.CONNECTIONS -> ClawConnectionsScreen(viewModel, controller, codexState)
                ClawRoot.SETTINGS -> ClawSettingsScreen(viewModel, state)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClawTopBar(
    screen: ClawRoot,
    pendingApprovals: Int,
    onApprovals: () -> Unit,
    onSettings: () -> Unit,
) {
    TopAppBar(
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.ic_launcher_foreground),
                    contentDescription = null,
                    modifier = Modifier.size(34.dp),
                )
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        if (screen == ClawRoot.HOME) "CLAW Bridge" else screen.label,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                    )
                    if (screen == ClawRoot.HOME) {
                        Text(
                            "dev by osx01",
                            fontSize = 8.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            letterSpacing = 0.8.sp,
                        )
                    }
                }
            }
        },
        actions = {
            IconButton(onClick = onApprovals) {
                Box {
                    Icon(Icons.Default.Shield, contentDescription = "Approvals")
                    if (pendingApprovals > 0) {
                        Surface(
                            modifier = Modifier.align(Alignment.TopEnd).size(14.dp),
                            shape = RoundedCornerShape(7.dp),
                            color = MaterialTheme.colorScheme.primary,
                        ) {
                            Text(
                                pendingApprovals.coerceAtMost(9).toString(),
                                color = Color.White,
                                fontSize = 8.sp,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                    }
                }
            }
            IconButton(onClick = onSettings) {
                Icon(Icons.Default.Settings, contentDescription = "Settings")
            }
        },
    )
}

@Composable
private fun ClawHome(
    state: AppUiState,
    codexState: ClawCodexState,
    onChat: () -> Unit,
    onCodex: () -> Unit,
    onApprovals: () -> Unit,
    onConnections: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 18.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(6.dp))
        Text("Your phone is the control plane", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            "Chat normally, hand full jobs to Codex, work inside the private Linux runtime, and bridge into Windows or servers without leaving the phone.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
            lineHeight = 19.sp,
        )
        StatusCard(
            title = "ChatGPT / Codex",
            value = codexState.authStatus.lines().lastOrNull().orEmpty().ifBlank { "Not checked" },
            icon = Icons.Default.Code,
        )
        StatusCard(
            title = "Local runtime",
            value = "Ubuntu PRoot · Gateway 127.0.0.1:8787",
            icon = Icons.Default.Terminal,
        )
        StatusCard(
            title = "Project provider",
            value = "${state.provider.kind.title} · ${state.provider.model}",
            icon = Icons.Default.Hub,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onChat, modifier = Modifier.weight(1f).height(52.dp)) {
                Icon(Icons.Default.Chat, null)
                Spacer(Modifier.width(7.dp))
                Text("Chat")
            }
            Button(onClick = onCodex, modifier = Modifier.weight(1f).height(52.dp)) {
                Icon(Icons.Default.Code, null)
                Spacer(Modifier.width(7.dp))
                Text("Codex")
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = onConnections, modifier = Modifier.weight(1f).height(48.dp)) {
                Icon(Icons.Default.Hub, null)
                Spacer(Modifier.width(6.dp))
                Text("Connections")
            }
            OutlinedButton(onClick = onApprovals, modifier = Modifier.weight(1f).height(48.dp)) {
                Icon(Icons.Default.Shield, null)
                Spacer(Modifier.width(6.dp))
                Text("Approvals ${if (codexState.approvals.isEmpty()) "" else "(${codexState.approvals.size})"}")
            }
        }
        ClawPanel("Included") {
            Text(
                "Chat · Codex workspace · Ubuntu · Terminal · Files · Projects · Approvals · Audit · Windows Host · PowerShell · Browser/UI automation · SSH server · Telegram · Gateway",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 18.sp,
            )
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun StatusCard(title: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(10.dp).size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(value, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun ClawChatScreen(controller: ClawCodexController, state: ClawCodexState) {
    var prompt by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("ChatGPT conversation", fontWeight = FontWeight.SemiBold)
                Text("Read-only Codex session. It cannot change your files from this tab.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = controller::clearChat, enabled = !state.chatRunning) {
                Icon(Icons.Default.Delete, contentDescription = "Clear chat")
            }
        }
        Spacer(Modifier.height(8.dp))
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.chat.isEmpty()) {
                item {
                    ClawPanel("Chat") {
                        Text(
                            "Sign in with ChatGPT under Connections, then chat here. Codex runs in read-only mode in this view.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
            items(state.chat, key = { it.id }) { entry ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = if (entry.fromUser) Arrangement.End else Arrangement.Start,
                ) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(if (entry.fromUser) 0.86f else 0.94f),
                        shape = RoundedCornerShape(16.dp),
                        color = if (entry.fromUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                    ) {
                        Text(entry.text, Modifier.padding(12.dp), fontSize = 13.sp, lineHeight = 19.sp)
                    }
                }
            }
            if (state.chatRunning && state.chatLiveOutput.isNotBlank()) {
                item {
                    Text(
                        state.chatLiveOutput.takeLast(2500),
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = prompt,
            onValueChange = { prompt = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Message ChatGPT…") },
            enabled = !state.chatRunning,
            minLines = 1,
            maxLines = 5,
        )
        Spacer(Modifier.height(7.dp))
        Button(
            onClick = {
                controller.sendChat(prompt)
                prompt = ""
            },
            enabled = prompt.isNotBlank() && !state.chatRunning,
            modifier = Modifier.fillMaxWidth().height(48.dp),
        ) {
            Icon(Icons.Default.Send, null)
            Spacer(Modifier.width(8.dp))
            Text(if (state.chatRunning) "Working…" else "Send")
        }
        Spacer(Modifier.height(10.dp))
    }
}

@Composable
private fun ClawCodexScreen(viewModel: MainViewModel, controller: ClawCodexController, state: ClawCodexState) {
    var task by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
        Text("Agent workspace", fontWeight = FontWeight.SemiBold)
        Text(
            "Give Codex a result, not fifty taps. It works in its own writable Linux workspace and uses CLAW approvals for remote actions.",
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        Surface(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(Modifier.padding(12.dp).verticalScroll(rememberScrollState())) {
                state.workspaceLog.forEach { line ->
                    Text(line, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 16.sp)
                    Spacer(Modifier.height(8.dp))
                }
                if (state.workspaceRunning && state.workspaceLiveOutput.isNotBlank()) {
                    HorizontalDivider()
                    Spacer(Modifier.height(8.dp))
                    Text(state.workspaceLiveOutput.takeLast(5000), fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                state.lastError?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = task,
            onValueChange = { task = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Build, fix, inspect or change…") },
            enabled = !state.workspaceRunning,
            minLines = 2,
            maxLines = 6,
        )
        Spacer(Modifier.height(7.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { controller.runWorkspaceTask(task); task = "" },
                enabled = task.isNotBlank() && !state.workspaceRunning,
                modifier = Modifier.weight(1f).height(48.dp),
            ) {
                Icon(Icons.Default.PlayArrow, null)
                Spacer(Modifier.width(6.dp))
                Text("Run Codex")
            }
            OutlinedButton(
                onClick = controller::stopActiveRun,
                enabled = state.workspaceRunning,
                modifier = Modifier.height(48.dp),
            ) {
                Icon(Icons.Default.Stop, contentDescription = "Stop")
            }
        }
        OutlinedButton(
            onClick = viewModel::createQuickProject,
            modifier = Modifier.fillMaxWidth().height(46.dp),
        ) {
            Icon(Icons.Default.Add, null)
            Spacer(Modifier.width(7.dp))
            Text("Open full project workspace")
        }
        Spacer(Modifier.height(10.dp))
    }
}

@Composable
private fun ClawTerminalScreen(viewModel: MainViewModel) {
    val lines by viewModel.terminalLines.collectAsStateWithLifecycle()
    val running by viewModel.isTerminalRunning.collectAsStateWithLifecycle()
    val live by viewModel.terminalLiveOutput.collectAsStateWithLifecycle()
    var command by rememberSaveable { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Ubuntu terminal", fontWeight = FontWeight.SemiBold)
                Text("Private PRoot environment on this phone", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = viewModel::clearTerminal) { Icon(Icons.Default.Delete, contentDescription = "Clear") }
        }
        Spacer(Modifier.height(8.dp))
        Surface(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = Color(0xFF060708),
        ) {
            Column(Modifier.padding(12.dp).verticalScroll(rememberScrollState())) {
                lines.takeLast(80).forEach { line ->
                    Text("$ ${line.command}", fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = MaterialTheme.colorScheme.primary)
                    if (line.output.isNotBlank()) Text(line.output, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 16.sp)
                    Spacer(Modifier.height(7.dp))
                }
                if (live.isNotBlank()) Text(live.takeLast(8000), fontFamily = FontFamily.Monospace, fontSize = 11.sp)
            }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(command, { command = it }, Modifier.fillMaxWidth(), enabled = !running, placeholder = { Text("Command") }, maxLines = 4)
        Spacer(Modifier.height(6.dp))
        Button(
            onClick = { viewModel.runTerminalCommand(command); command = "" },
            enabled = command.isNotBlank() && !running,
            modifier = Modifier.fillMaxWidth().height(46.dp),
        ) { Text(if (running) "Running…" else "Run") }
        Spacer(Modifier.height(10.dp))
    }
}

@Composable
private fun ClawApprovalsScreen(controller: ClawCodexController, state: ClawCodexState) {
    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
        Text("Remote actions", fontWeight = FontWeight.SemiBold)
        Text(
            "Windows writes, PowerShell, screenshots and remote server writes/commands stop here until you approve them.",
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        if (state.approvals.isEmpty()) {
            ClawPanel("No pending approvals") {
                Text("Nothing is waiting for permission.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.approvals, key = { it.id }) { request ->
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text(request.toolName, fontWeight = FontWeight.Bold)
                            Text(request.description, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            request.command?.let { Text(it, fontFamily = FontFamily.Monospace, fontSize = 10.sp) }
                            request.path?.let { Text(it, fontFamily = FontFamily.Monospace, fontSize = 10.sp) }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { controller.answerApproval(request.id, false) }, modifier = Modifier.weight(1f)) {
                                    Text("Deny")
                                }
                                Button(onClick = { controller.answerApproval(request.id, true) }, modifier = Modifier.weight(1f)) {
                                    Icon(Icons.Default.Check, null)
                                    Spacer(Modifier.width(6.dp))
                                    Text("Allow once")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ClawConnectionsScreen(viewModel: MainViewModel, controller: ClawCodexController, codexState: ClawCodexState) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val prefs = remember { context.getSharedPreferences("claw_connections", Context.MODE_PRIVATE) }
    val vault = remember { ConnectionVault(context) }
    val terminalRunning by viewModel.isTerminalRunning.collectAsStateWithLifecycle()
    val terminalLive by viewModel.terminalLiveOutput.collectAsStateWithLifecycle()
    val terminalLines by viewModel.terminalLines.collectAsStateWithLifecycle()

    var windowsUrl by rememberSaveable { mutableStateOf(viewModel.windowsHostUrl()) }
    var windowsToken by rememberSaveable { mutableStateOf(viewModel.getSavedWindowsHostToken()) }
    var server by rememberSaveable { mutableStateOf(prefs.getString("server", "") ?: "") }
    var serverUser by rememberSaveable { mutableStateOf(prefs.getString("server_user", "") ?: "") }
    var serverPort by rememberSaveable { mutableStateOf(prefs.getInt("server_port", 22).toString()) }
    var telegramToken by rememberSaveable { mutableStateOf(vault.get("telegram_bot_token").orEmpty()) }
    var telegramChat by rememberSaveable { mutableStateOf(prefs.getString("telegram_chat", "") ?: "") }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 14.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ConnectionCard("ChatGPT / Codex", "One ChatGPT login powers both Chat and Codex", Icons.Default.Code) {
            Text(codexState.authStatus.takeLast(2000), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(
                onClick = controller::connectChatGpt,
                enabled = !codexState.authRunning,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (codexState.authRunning) "Connecting…" else "Connect ChatGPT / Codex") }
            OutlinedButton(onClick = controller::checkLogin, enabled = !codexState.authRunning, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Refresh, null)
                Spacer(Modifier.width(6.dp))
                Text("Check login")
            }
        }

        ConnectionCard("Windows Host", "PowerShell, files, browser and Windows UI automation", Icons.Default.Computer) {
            OutlinedTextField(windowsUrl, { windowsUrl = it }, Modifier.fillMaxWidth(), label = { Text("WebSocket URL") }, placeholder = { Text("ws://192.168.1.20:8790") })
            OutlinedTextField(
                windowsToken,
                { windowsToken = it },
                Modifier.fillMaxWidth(),
                label = { Text("Pairing token") },
                visualTransformation = PasswordVisualTransformation(),
            )
            Button(
                onClick = {
                    viewModel.saveWindowsHost(windowsUrl, windowsToken)
                    viewModel.runTerminalCommand("node /opt/claw-gateway/claw-tool.mjs windows_status '{}'")
                },
                enabled = windowsUrl.isNotBlank() && windowsToken.isNotBlank() && !terminalRunning,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save & test Windows Host") }
            Text("High-impact Windows actions always route through Approvals.", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        ConnectionCard("Server", "Persistent SSH access from the phone runtime", Icons.Default.Dns) {
            OutlinedTextField(server, { server = it }, Modifier.fillMaxWidth(), label = { Text("Host / IP") })
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(serverUser, { serverUser = it }, Modifier.weight(1f), label = { Text("User") })
                OutlinedTextField(serverPort, { serverPort = it.filter(Char::isDigit).take(5) }, Modifier.width(112.dp), label = { Text("Port") })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = controller::generateSshKey, enabled = !codexState.workspaceRunning, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Key, null)
                    Spacer(Modifier.width(5.dp))
                    Text("SSH key")
                }
                Button(
                    onClick = { controller.testServer(server, serverUser, serverPort.toIntOrNull() ?: 22); GatewayService.restart(context) },
                    enabled = server.isNotBlank() && !codexState.workspaceRunning,
                    modifier = Modifier.weight(1f),
                ) { Text("Save & test") }
            }
            Text("Copy the generated public key to the server's ~/.ssh/authorized_keys once. Server writes and shell actions require phone approval.", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        ConnectionCard("Telegram", "Send CLAW results to your Telegram chat", Icons.Default.Telegram) {
            OutlinedTextField(
                telegramToken,
                { telegramToken = it },
                Modifier.fillMaxWidth(),
                label = { Text("Bot token") },
                visualTransformation = PasswordVisualTransformation(),
            )
            OutlinedTextField(telegramChat, { telegramChat = it }, Modifier.fillMaxWidth(), label = { Text("Chat ID") })
            Button(
                onClick = {
                    vault.put("telegram_bot_token", telegramToken)
                    prefs.edit().putString("telegram_chat", telegramChat.trim()).apply()
                    GatewayService.restart(context)
                    val safeChat = telegramChat.trim().replace("'", "")
                    viewModel.runTerminalCommand("node /opt/claw-gateway/claw-tool.mjs telegram_send '{\"text\":\"CLAW Bridge connected\"}'")
                    if (safeChat.isBlank()) Unit
                },
                enabled = telegramToken.isNotBlank() && telegramChat.isNotBlank() && !terminalRunning,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save & test Telegram") }
            Text("The bot token is encrypted with Android Keystore.", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        val output = terminalLive.ifBlank { terminalLines.lastOrNull()?.output.orEmpty() }
        if (output.isNotBlank() || codexState.workspaceLiveOutput.isNotBlank()) {
            ClawPanel("Connection output") {
                Text(
                    (codexState.workspaceLiveOutput.ifBlank { output }).takeLast(3500),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    lineHeight = 15.sp,
                )
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun ConnectionCard(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Column {
                    Text(title, fontWeight = FontWeight.SemiBold)
                    Text(subtitle, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            content()
        }
    }
}

@Composable
private fun ClawSettingsScreen(viewModel: MainViewModel, state: AppUiState) {
    var expanded by remember { mutableStateOf(false) }
    var providerKind by rememberSaveable { mutableStateOf(state.provider.kind) }
    var model by rememberSaveable { mutableStateOf(state.provider.model) }
    var baseUrl by rememberSaveable { mutableStateOf(state.provider.baseUrl) }
    var secret by rememberSaveable { mutableStateOf("") }
    var confirmSave by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 14.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ConnectionCard("Appearance", "Uses Android's system font; terminal remains monospace", Icons.Default.Settings) {
            OutlinedButton(onClick = viewModel::toggleTheme, modifier = Modifier.fillMaxWidth()) {
                Text("Toggle light / dark")
            }
        }

        ConnectionCard("Claude & API providers", "Used by the full project workspace", Icons.Default.Hub) {
            Box {
                OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(providerKind.title)
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    ProviderKind.entries.forEach { kind ->
                        DropdownMenuItem(
                            text = { Text(kind.title) },
                            onClick = {
                                providerKind = kind
                                model = kind.defaultModel
                                baseUrl = kind.defaultBaseUrl
                                expanded = false
                            },
                        )
                    }
                }
            }
            if (providerKind != ProviderKind.CLAUDE) {
                OutlinedTextField(baseUrl, { baseUrl = it }, Modifier.fillMaxWidth(), label = { Text("Base URL") })
                OutlinedTextField(model, { model = it }, Modifier.fillMaxWidth(), label = { Text("Model") })
                OutlinedTextField(secret, { secret = it }, Modifier.fillMaxWidth(), label = { Text("API key") }, visualTransformation = PasswordVisualTransformation())
            } else {
                Text("Claude subscription login remains available inside the project runtime.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(onClick = { confirmSave = true }, modifier = Modifier.fillMaxWidth()) { Text("Save provider") }
        }

        ClawPanel("Security") {
            Text("Connection secrets stay in Android Keystore-backed encrypted storage. Remote Windows/server changes require explicit approval.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(20.dp))
    }

    if (confirmSave) {
        AlertDialog(
            onDismissRequest = { confirmSave = false },
            title = { Text("Save provider?") },
            text = { Text("This changes the provider used by full CLAW project workspaces.") },
            confirmButton = {
                Button(onClick = {
                    viewModel.finishOnboarding(
                        ProviderProfile(kind = providerKind, baseUrl = baseUrl, model = model),
                        secret,
                    )
                    secret = ""
                    confirmSave = false
                }) { Text("Save") }
            },
            dismissButton = { OutlinedButton(onClick = { confirmSave = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ClawPanel(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}
