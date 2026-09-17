package com.nexus.classroom

/** JavaScript bridge contract. Back this with Google Nearby Connections in the Android shell. */
interface NexusNativeBridge {
    fun getStatus(): Map<String, Any?>
    fun startAdvertising(classId: String?)
    fun startDiscovery(classId: String?)
    fun accept(endpointId: String)
    fun reject(endpointId: String)
    fun send(endpointId: String, payload: ByteArray)
    fun sendFile(endpointId: String, path: String)
    fun stop()
}
