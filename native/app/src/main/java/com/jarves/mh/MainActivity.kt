package com.jarves.mh

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jarves.mh.ui.ClawBridgeApp
import com.jarves.mh.ui.MainViewModel
import com.jarves.mh.ui.theme.PocketTheme
import com.jarves.mh.runtime.GatewayService
import com.jarves.mh.runtime.RuntimeInstaller

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val vm: MainViewModel = viewModel()
            val state by vm.state.collectAsStateWithLifecycle()
            PocketTheme(themeMode = state.themeMode) {
                ClawBridgeApp(vm)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (RuntimeInstaller(this).isInstalled()) GatewayService.start(this)
    }
}
