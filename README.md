# Nexus Master Android Engine

Base Android nativa para convertir la interfaz web en una aplicación con transporte offline real.

- Android Gradle Plugin 9.4.0
- Google Play services Nearby 19.5.0
- WebView restringida a orígenes propios
- `NexusNative` expuesto al JS
- Nearby Connections con `P2P_CLUSTER`
- permisos modernos Bluetooth / Nearby Wi‑Fi

Nearby Connections permite comunicación P2P completamente offline mediante Bluetooth, BLE y Wi‑Fi;
la estrategia P2P_CLUSTER permite topologías de varios dispositivos. La autenticación debe conservarse
activa antes de aceptar pares en producción.
