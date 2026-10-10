# Reference architecture

```text
Recently Played ─┐
Liked Songs ─────┼─> bounded private collector ─> structured mood/music profile
Private chat ────┘                  │                    │
     │ transient local embedding ───┘                    │
     └─ raw text and query vectors discarded             v
                                            ephemeral query vector
MusicBrainz + permitted lyric source ─> grounded song documents
                                         │
                                         v
                           versioned persistent song-vector cache
                                         │
                                         v
                         cosine/ANN retrieval + deterministic filters
                                         │
                                         v
                          privacy-safe report + idempotent relay

Health plane: 60-second dual-endpoint probe -> one refresh/retry ->
second failure marks unhealthy -> deduplicated alert -> recovery alert.
```

Recommended persisted song-vector key:

```text
canonical_recording_id
embedding_model_id
embedding_model_version
document_sha256
audio_feature_version (optional)
```

Recommended health-state fields:

```text
schema
checked_at
status: healthy | suspect | unhealthy
safe_reason_code
consecutive_failures
latency_ms
last_healthy_at
unhealthy_since
pending_alert
last_alert_kind
last_alert_at
```
