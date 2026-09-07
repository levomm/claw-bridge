package com.jarves.mh

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jarves.mh.runtime.GatewayService
import com.jarves.mh.runtime.RuntimeInstaller
import com.jarves.mh.ui.ClawBridgeApp
import com.jarves.mh.ui.ClawLaunchScreen
import com.jarves.mh.ui.MainViewModel
import com.jarves.mh.ui.theme.PocketTheme
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val vm: MainViewModel = viewModel()
            val state by vm.state.collectAsStateWithLifecycle()
            var showLaunch by remember { mutableStateOf(true) }

            LaunchedEffect(Unit) {
                delay(1600)
                showLaunch = false
            }

            PocketTheme(themeMode = state.themeMode) {
                if (showLaunch) ClawLaunchScreen() else ClawBridgeApp(vm)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (RuntimeInstaller(this).isInstalled()) GatewayService.start(this)
    }
}
