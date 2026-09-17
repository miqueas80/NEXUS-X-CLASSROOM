# RED NEXUS // MONSTER 40

## Objective
Keep the visible RED NEXUS CLASSROOM interface intact while moving the real system underneath it toward a distributed, offline-first classroom fabric.

## Kernel layers
1. **Identity** — per-device ECDSA P-256 identity. Private signing key is stored as a non-extractable `CryptoKey` in IndexedDB; only the public JWK leaves the device.
2. **Causality** — Hybrid Logical Clock plus per-node frontier. Events carry causal dependencies and are ordered deterministically.
3. **Event fabric** — append-only events, hashes, signatures, deduplication and materialization. Remote events are idempotent.
4. **Anti-entropy** — HELLO → SYNC_REQUEST → SYNC_BATCH. Nodes exchange event batches rather than trusting a central snapshot.
5. **Content fabric** — content-addressed file IDs, fixed chunks, per-chunk SHA-256, resumable reception and final whole-file integrity verification.
6. **Transport abstraction** — native Nearby first when available, then local broadcast/store-forward. WebRTC/WebTransport are reserved as adapters rather than hard dependencies.
7. **Local AI** — optional WebLLM worker. The classroom kernel remains functional if WebGPU or a local model is unavailable.
8. **Resource governor** — detects CPU/RAM/save-data constraints and exposes conservative profiles for battery and thermal policies.
9. **Service-worker delivery** — v40 can inject the kernel into the existing HTML at navigation time, so the original visual shell does not have to be rewritten.

## Important physical-network boundary
A normal webpage cannot turn arbitrary phones into a Bluetooth/Wi-Fi mesh. The Android layer is therefore the authoritative nearby transport. Google Nearby Connections supports `P2P_CLUSTER`, which is an M-to-N cluster topology suitable for mesh-like nearby workloads. citeturn0search0turn0search7

The Android implementation must keep connection authentication enabled and surface the authentication digits before accepting a peer. Unauthenticated Nearby connections are not secure. 

## AI boundary
Local inference is progressive enhancement. WebLLM can run in-browser with WebGPU and persistent model caching; the v40 worker keeps inference off the UI thread. citeturn0search5turn0search19

## Failure model
- Internet disappears: event queue and local state continue.
- A peer disappears: chunks remain resumable and events remain pending.
- Same event arrives twice: `seen` store makes application idempotent.
- Events arrive in different orders: causal frontier and deterministic materialization prevent blind last-write races.
- File corruption: chunk hash or final file hash fails closed.
- WebGPU unavailable: local retrieval remains available; classroom transport is unaffected.

## Not claimed yet
This is an engineering foundation, not a declaration of production readiness. The real acceptance gate is multi-device testing: Android ↔ Android nearby transfer, reconnect after radio loss, concurrent edits, duplicate delivery, corrupted chunks, and long offline periods.

## FABRIC 80 — Network Lab

FABRIC 80 adds a deterministic in-memory network simulator used only for engineering verification. It models nodes, links, partitions, reconnection, event reordering, duplicate delivery, causal queues and convergence audits. Production transport remains separate from the simulator.

The simulator is deliberately deterministic so failures can be reproduced from the same seed. A future native test harness can use the same scenarios against Nearby Connections.
