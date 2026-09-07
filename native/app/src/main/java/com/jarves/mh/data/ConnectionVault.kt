package com.jarves.mh.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypted storage for non-provider CLAW connection secrets such as Telegram bot tokens. */
class ConnectionVault(context: Context) {
    private val preferences = context.getSharedPreferences("claw_connection_secrets", Context.MODE_PRIVATE)
    private val alias = "claw-connection-key"

    fun put(id: String, secret: String) {
        if (secret.isBlank()) {
            remove(id)
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString("$id.iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("$id.value", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply()
    }

    fun get(id: String): String? = runCatching {
        val iv = Base64.decode(preferences.getString("$id.iv", null), Base64.NO_WRAP)
        val encrypted = Base64.decode(preferences.getString("$id.value", null), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }.getOrNull()

    fun remove(id: String) {
        preferences.edit().remove("$id.iv").remove("$id.value").apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }
}
