package com.jarves.mh.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jarves.mh.R
import com.jarves.mh.runtime.ClawCodexController

private val SetupRed = Color(0xFFEF3D45)
private val SetupGreen = Color(0xFF7CFF6B)

@Composable
fun ClawAiSetupScreen(viewModel: MainViewModel) {
    val appState by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var showApiProviders by rememberSaveable { mutableStateOf(false) }

    if (showApiProviders) {
        PocketDevApp(viewModel)
        return
    }

    val controller = remember(context) { ClawCodexController(context) }
    val codexState by controller.state.collectAsStateWithLifecycle()
    DisposableEffect(controller) {
        onDispose { controller.close() }
    }
    LaunchedEffect(Unit) {
        controller.checkLogin()
    }

    val loggedIn = remember(codexState.authStatus, codexState.lastError) {
        codexState.lastError == null && (
            codexState.authStatus.contains("logged in", ignoreCase = true) ||
                codexState.authStatus.contains("connected", ignoreCase = true)
            )
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(Modifier.height(22.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.ic_launcher_foreground),
                    contentDescription = null,
                    modifier = Modifier.size(46.dp),
                )
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Set up CLAW Bridge", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Text("dev by osx01", fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, letterSpacing = 0.8.sp)
                }
            }

            Spacer(Modifier.height(26.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(3) { index ->
                    Surface(
                        modifier = Modifier.weight(1f).height(5.dp),
                        shape = RoundedCornerShape(99.dp),
                        color = if (index <= 1) SetupRed else MaterialTheme.colorScheme.outlineVariant,
                    ) {}
                }
            }

            Spacer(Modifier.height(22.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("STEP 2 OF 3", color = SetupRed, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                Spacer(Modifier.weight(1f))
                Surface(color = SetupGreen.copy(alpha = 0.10f), shape = RoundedCornerShape(99.dp)) {
                    Row(Modifier.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Security, null, tint = SetupGreen, modifier = Modifier.size(13.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("Secure setup", color = SetupGreen, fontSize = 10.sp)
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Text("Connect your AI", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(
                "Use your ChatGPT account for both Chat and the separate Codex workspace, or configure another model provider.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
                lineHeight = 19.sp,
            )

            Spacer(Modifier.height(20.dp))
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, SetupRed.copy(alpha = 0.55f)),
            ) {
                Column(Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(12.dp), color = SetupRed.copy(alpha = 0.12f)) {
                            Icon(Icons.Default.Code, null, tint = SetupRed, modifier = Modifier.padding(11.dp).size(23.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("ChatGPT / Codex", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Text("Sign in with your ChatGPT account", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }

                    Spacer(Modifier.height(14.dp))
                    Text(
                        "Chat runs as a read-only conversation. Codex gets its own writable agent workspace for building, editing and testing.",
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = controller::connectChatGpt,
                        enabled = !codexState.authRunning,
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SetupRed, contentColor = Color.White),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        if (codexState.authRunning) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                            Spacer(Modifier.width(9.dp))
                            Text("Waiting for ChatGPT…")
                        } else {
                            Icon(Icons.Default.Key, null)
                            Spacer(Modifier.width(8.dp))
                            Text(if (loggedIn) "Reconnect ChatGPT" else "Sign in with ChatGPT", fontWeight = FontWeight.Bold)
                        }
                    }

                    if (codexState.authStatus.isNotBlank()) {
                        Spacer(Modifier.height(12.dp))
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                        ) {
                            Text(
                                codexState.authStatus.takeLast(3000),
                                modifier = Modifier.padding(12.dp),
                                fontFamily = FontFamily.Monospace,
                                fontSize = 10.sp,
                                lineHeight = 15.sp,
                                color = if (codexState.lastError == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                            )
                        }
                    }

                    if (loggedIn) {
                        Spacer(Modifier.height(12.dp))
                        Text("ChatGPT connected", color = SetupGreen, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { showApiProviders = true },
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Key, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Claude / API providers", fontWeight = FontWeight.SemiBold)
                        Text("Anthropic, OpenRouter, DeepSeek, Kimi or Custom API", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text("›", fontSize = 24.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            Spacer(Modifier.height(22.dp))
            Button(
                onClick = { viewModel.finishOnboarding(appState.provider, "") },
                enabled = loggedIn,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = SetupRed, contentColor = Color.White),
            ) {
                Text("Continue with ChatGPT", fontWeight = FontWeight.Bold)
            }

            OutlinedButton(
                onClick = { viewModel.finishOnboarding(appState.provider, "") },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(48.dp),
                shape = RoundedCornerShape(14.dp),
            ) {
                Text("Skip for now")
            }

            Spacer(Modifier.height(18.dp))
            Text(
                "ChatGPT/Codex authentication is stored inside the local Linux runtime. API keys for other providers stay in Android secure storage.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.5.sp,
                lineHeight = 16.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}
