package com.jarves.mh.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jarves.mh.model.ProviderKind
import com.jarves.mh.model.ProviderProfile
import com.jarves.mh.runtime.ClawCodexController

@Composable
fun ClawModelSetupScreen(
    viewModel: MainViewModel,
    onOtherProviders: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val controller = remember(context) { ClawCodexController(context) }
    val codex by controller.state.collectAsStateWithLifecycle()

    DisposableEffect(controller) {
        controller.checkLogin()
        onDispose { controller.close() }
    }

    val connected = codex.authStatus.contains("logged in", ignoreCase = true) ||
        codex.authStatus.contains("connected", ignoreCase = true)

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "STEP 2 OF 3",
                color = MaterialTheme.colorScheme.primary,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
            )
            Spacer(Modifier.weight(1f))
            Surface(
                color = Color(0xFF65E56C).copy(alpha = 0.10f),
                shape = RoundedCornerShape(50),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Security, null, tint = Color(0xFF65E56C), modifier = Modifier.size(14.dp))
                    Spacer(Modifier.size(6.dp))
                    Text("Secure setup", color = Color(0xFF65E56C), fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        Text("Connect your AI", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            "Use your ChatGPT subscription for Codex, or choose Claude/API providers.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
        )

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier.size(42.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f), RoundedCornerShape(12.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.Code, null, tint = MaterialTheme.colorScheme.primary)
                    }
                    Spacer(Modifier.size(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("ChatGPT / Codex subscription", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Text("Use your ChatGPT plan · no OpenAI API key", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
                    }
                    if (connected) Icon(Icons.Default.Check, "Connected", tint = Color(0xFF65E56C))
                }

                Text(
                    codex.authStatus.takeLast(1200),
                    color = if (codex.lastError == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                    fontSize = 11.sp,
                )

                if (!connected) {
                    Button(
                        onClick = controller::connectChatGpt,
                        enabled = !codex.authRunning,
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                    ) {
                        if (codex.authRunning) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.size(8.dp))
                        }
                        Text(if (codex.authRunning) "Connecting…" else "Connect ChatGPT / Codex")
                    }
                    OutlinedButton(
                        onClick = controller::checkLogin,
                        enabled = !codex.authRunning,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Refresh, null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.size(7.dp))
                        Text("Check login")
                    }
                } else {
                    Button(
                        onClick = {
                            // Codex is a separate native harness connection. Keep the legacy
                            // project-provider slot neutral; Claude/API can be configured later.
                            viewModel.finishOnboarding(ProviderProfile(ProviderKind.CLAUDE), "")
                        },
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                    ) {
                        Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.size(7.dp))
                        Text("Continue with Codex")
                    }
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Surface(
            modifier = Modifier.fillMaxWidth().clickable(onClick = onOtherProviders),
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(42.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Hub, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Claude & API providers", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Text(
                        "Claude subscription · Anthropic · OpenRouter · DeepSeek · Kimi · Custom",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.5.sp,
                    )
                }
            }
        }

        Spacer(Modifier.weight(1f))
        Text(
            "Codex login stays inside CLAW Bridge's private Linux runtime. Provider API keys use Android secure storage.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.5.sp,
        )
    }
}
