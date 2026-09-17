# RED NEXUS MASTER 31

## Principio
La web parece un aula normal. Debajo funciona un núcleo distribuido offline-first.

## Capas
- UI original
- Nexus Master Core
- Event log idempotente
- Knowledge Fabric local
- OPFS/IndexedDB
- Router de transportes
- IA local/online
- Bridge Android
- Sincronización eventual

## Rutas de transporte
1. Android + Google Nearby Connections: offline nativo (Bluetooth/BLE/Wi‑Fi).
2. WebRTC: P2P IP.
3. WebTransport: canal moderno online cuando esté disponible.
4. BroadcastChannel: bus local entre contextos del mismo origen.
5. Store-and-forward: cola persistente.

## IA
WebGPU -> modelo local (WebLLM/Worker) cuando el dispositivo lo soporte.
Sin WebGPU -> RAG local determinista como fallback.
Internet -> proveedor remoto opcional.

## Datos
Eventos con `id`, `nodeId`, `kind`, `classId`, `payload`, `createdAt`, `status`, `schema`.
Nunca se debe asumir que los eventos llegan ordenados. La siguiente fase debe añadir deduplicación,
versiones vectoriales/lamport y resolución explícita de conflictos.

## Seguridad
La identidad del nodo es local. El bridge Android debe autenticar endpoints y usar el canal seguro
de Nearby. Las credenciales remotas nunca deben quedar en el frontend.
