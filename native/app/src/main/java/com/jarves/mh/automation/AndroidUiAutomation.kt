package com.jarves.mh.automation

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

object AndroidUiAutomation {
    private fun service(): ClawAccessibilityService =
        ClawAccessibilityService.instance ?: error("CLAW Accessibility service is not enabled")

    fun execute(name: String, input: JSONObject): JSONObject {
        val result = when (name) {
            "status" -> JSONObject().put("enabled", ClawAccessibilityService.instance != null)
            "tree" -> JSONObject().put("nodes", dumpTree(service().root()))
            "click_text" -> JSONObject().put("ok", clickText(input.getString("text")))
            "click_id" -> JSONObject().put("ok", clickId(input.getString("viewId")))
            "set_text" -> JSONObject().put("ok", setText(input.getString("selector"), input.optString("value")))
            "tap" -> JSONObject().put("ok", service().tap(input.getDouble("x").toFloat(), input.getDouble("y").toFloat()))
            "scroll" -> JSONObject().put("ok", scroll(input.optBoolean("forward", true)))
            "global" -> JSONObject().put("ok", service().global(input.getString("action")))
            else -> error("Unknown Android UI action: $name")
        }
        return result.put("action", name)
    }

    private fun clickText(text: String): Boolean {
        val root = service().root() ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(text)
        val exact = nodes.firstOrNull { node ->
            node.text?.toString()?.equals(text, ignoreCase = true) == true ||
                node.contentDescription?.toString()?.equals(text, ignoreCase = true) == true
        }
        return exact?.let(service()::click) ?: nodes.firstOrNull()?.let(service()::click) ?: false
    }

    private fun clickId(viewId: String): Boolean {
        val root = service().root() ?: return false
        return root.findAccessibilityNodeInfosByViewId(viewId).firstOrNull()?.let(service()::click) ?: false
    }

    private fun setText(selector: String, value: String): Boolean {
        val root = service().root() ?: return false
        val byId = runCatching { root.findAccessibilityNodeInfosByViewId(selector) }.getOrDefault(emptyList())
        val node = byId.firstOrNull() ?: root.findAccessibilityNodeInfosByText(selector).firstOrNull()
        return node?.let { service().setText(it, value) } ?: false
    }

    private fun scroll(forward: Boolean): Boolean {
        val root = service().root() ?: return false
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isScrollable && service().scroll(node, forward)) return true
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add)
        }
        return false
    }

    private fun dumpTree(root: AccessibilityNodeInfo?): JSONArray {
        val out = JSONArray()
        if (root == null) return out
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.add(root to 0)
        while (queue.isNotEmpty() && out.length() < 500) {
            val (node, depth) = queue.removeFirst()
            val bounds = Rect().also(node::getBoundsInScreen)
            out.put(JSONObject()
                .put("depth", depth)
                .put("class", node.className?.toString().orEmpty())
                .put("text", node.text?.toString().orEmpty())
                .put("description", node.contentDescription?.toString().orEmpty())
                .put("viewId", node.viewIdResourceName.orEmpty())
                .put("clickable", node.isClickable)
                .put("editable", node.isEditable)
                .put("scrollable", node.isScrollable)
                .put("bounds", JSONArray(listOf(bounds.left, bounds.top, bounds.right, bounds.bottom))))
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it to depth + 1) }
        }
        return out
    }
}
