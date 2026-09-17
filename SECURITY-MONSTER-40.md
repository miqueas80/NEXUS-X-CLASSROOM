# Security model — Monster 40

- Node identity: ECDSA P-256.
- Private signing key: non-extractable `CryptoKey` persisted in IndexedDB.
- Every event: content hash + signature.
- Remote event: public key supplied with the envelope; signature and hash are verified before acceptance.
- Transport: Nearby Connections is expected to retain its authenticated pairing flow.
- UI bridge: Android WebView must only load trusted local assets or explicitly allowlisted project origins.
- No classroom secret is embedded in frontend JavaScript.
- No claim of end-to-end security is made until native transport, identity rotation, replay handling, authorization and key recovery are tested together.
