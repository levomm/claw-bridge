package com.jarves.mh.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

// Legacy names are kept for source compatibility with the upstream native shell.
// The actual palette is CLAW Bridge.
val PocketOrange = Color(0xFFEF3D45)
val PocketBlue = Color(0xFFAEB5BD)
val PocketGreen = Color(0xFF7CFF6B)
val PocketBackground = Color(0xFF090B0D)
val PocketSurface = Color(0xFF111417)
val PocketSurfaceVariant = Color(0xFF171B1F)
val PocketOutline = Color(0xFF292F35)

private val DarkColors = darkColorScheme(
    primary = PocketOrange,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF391518),
    onPrimaryContainer = Color(0xFFFFDADD),
    secondary = PocketBlue,
    onSecondary = Color(0xFF15191D),
    tertiary = PocketGreen,
    onTertiary = Color(0xFF062505),
    background = PocketBackground,
    onBackground = Color(0xFFF2F4F6),
    surface = PocketSurface,
    onSurface = Color(0xFFF2F4F6),
    surfaceVariant = PocketSurfaceVariant,
    onSurfaceVariant = Color(0xFF9AA2AA),
    outline = PocketOutline,
    outlineVariant = Color(0xFF333A41),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFFC62E37),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDADD),
    onPrimaryContainer = Color(0xFF3D0710),
    secondary = Color(0xFF555F68),
    onSecondary = Color.White,
    tertiary = Color(0xFF2F7D2A),
    onTertiary = Color.White,
    background = Color(0xFFF7F8F9),
    onBackground = Color(0xFF17191C),
    surface = Color.White,
    onSurface = Color(0xFF17191C),
    surfaceVariant = Color(0xFFEEF0F2),
    onSurfaceVariant = Color(0xFF5A626A),
    outline = Color(0xFFCDD2D7),
    outlineVariant = Color(0xFFDDE1E5),
)

enum class AppThemeMode { SYSTEM, DARK, LIGHT }

@Composable
fun PocketTheme(themeMode: AppThemeMode = AppThemeMode.SYSTEM, content: @Composable () -> Unit) {
    val isDark = when (themeMode) {
        AppThemeMode.DARK -> true
        AppThemeMode.LIGHT -> false
        AppThemeMode.SYSTEM -> isSystemInDarkTheme()
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            val insetsController = WindowCompat.getInsetsController(window, view)
            insetsController.isAppearanceLightStatusBars = !isDark
            insetsController.isAppearanceLightNavigationBars = !isDark
        }
    }

    MaterialTheme(
        colorScheme = if (isDark) DarkColors else LightColors,
        content = content,
    )
}
