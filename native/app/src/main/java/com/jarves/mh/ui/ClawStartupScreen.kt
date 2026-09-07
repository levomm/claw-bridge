package com.jarves.mh.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jarves.mh.R

private val StartupRed = Color(0xFFEF3D45)
private val StartupBackground = Color(0xFF090B0D)
private val StartupPanel = Color(0xFF111417)
private val StartupText = Color(0xFFF2F4F6)
private val StartupMuted = Color(0xFF8B939C)
private val StartupGreen = Color(0xFF7CFF6B)

@Composable
fun ClawStartupScreen(state: AppUiState, onRetry: () -> Unit) {
    val error = state.startupStage == StartupStage.ERROR
    val title = when (state.startupStage) {
        StartupStage.CHECKING -> "Starting CLAW Bridge"
        StartupStage.INSTALLING -> "Building local runtime"
        StartupStage.INITIALIZING -> "Bringing CLAW online"
        StartupStage.ERROR -> "Setup stopped"
        else -> "CLAW Bridge"
    }
    val subtitle = when (state.startupStage) {
        StartupStage.CHECKING -> "Checking the phone and local runtime"
        StartupStage.INSTALLING -> "Installing the private Linux workspace on this phone"
        StartupStage.INITIALIZING -> "Starting gateway, tools and agent services"
        StartupStage.ERROR -> state.startupError ?: "CLAW Bridge could not finish setup"
        else -> state.startupMessage
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(StartupBackground)
            .padding(horizontal = 22.dp, vertical = 26.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(20.dp))
            Surface(
                modifier = Modifier.size(92.dp),
                shape = RoundedCornerShape(28.dp),
                color = StartupPanel,
                border = androidx.compose.foundation.BorderStroke(1.dp, StartupRed.copy(alpha = 0.35f)),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Image(
                        painter = painterResource(R.drawable.ic_launcher_foreground),
                        contentDescription = "CLAW Bridge",
                        modifier = Modifier.size(74.dp),
                    )
                }
            }
            Spacer(Modifier.height(18.dp))
            Text(
                "CLAW BRIDGE",
                color = StartupText,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
            )
            Text(
                "dev by osx01",
                color = StartupMuted,
                fontSize = 9.sp,
                letterSpacing = 1.sp,
            )

            Spacer(Modifier.height(42.dp))
            Text(
                title,
                color = StartupText,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                subtitle,
                color = StartupMuted,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(26.dp))

            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                color = StartupPanel,
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF292F35)),
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                if (error) Icons.Default.ErrorOutline else Icons.Default.Memory,
                                contentDescription = null,
                                tint = StartupRed,
                            )
                            Spacer(Modifier.size(10.dp))
                            Text(
                                if (error) "Setup error" else "Local CLAW runtime",
                                color = StartupText,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        if (!error && !state.startupIndeterminate) {
                            Text(
                                "${(state.startupProgress.coerceIn(0f, 1f) * 100f).toInt()}%",
                                color = StartupRed,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }

                    if (!error) {
                        if (state.startupIndeterminate) {
                            LinearProgressIndicator(
                                modifier = Modifier.fillMaxWidth().height(5.dp),
                                color = StartupRed,
                                trackColor = Color(0xFF20252A),
                            )
                        } else {
                            LinearProgressIndicator(
                                progress = { state.startupProgress.coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth().height(5.dp),
                                color = StartupRed,
                                trackColor = Color(0xFF20252A),
                            )
                        }
                    }

                    if (state.startupMessage.isNotBlank()) {
                        Text(
                            state.startupMessage,
                            color = StartupMuted,
                            fontSize = 11.sp,
                            lineHeight = 16.sp,
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                color = Color(0xFF15191C),
            ) {
                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = StartupGreen, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.size(9.dp))
                    Text(
                        "Private Linux runtime on your phone. Remote actions remain permission-gated.",
                        color = StartupMuted,
                        fontSize = 10.sp,
                        lineHeight = 15.sp,
                    )
                }
            }

            if (error) {
                Spacer(Modifier.height(18.dp))
                Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().height(50.dp)) {
                    Text("Retry setup", fontWeight = FontWeight.Bold)
                }
            }

            Spacer(Modifier.weight(1f))
            Text("CLAW Bridge native preview", color = Color(0xFF515860), fontSize = 9.sp)
            Spacer(Modifier.height(8.dp))
        }
    }
}
