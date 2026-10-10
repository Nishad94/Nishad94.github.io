---
name: "spotify-mood-recommender"
description: "Build or repair private Spotify mood recommendations with ephemeral chat embeddings, grounded songs, vector caching, OAuth health checks, and bounded alerts."
---

# Spotify Mood Recommender

Build or repair a private Spotify recommendation workflow that combines recent listening, a verified Liked Songs mix, private mood signals, grounded song metadata, local embeddings, and continuous OAuth supervision.

## 1. Establish the privacy and product contract

1. Confirm the owner-authorized private signals, output destination, recommendation cadence, and maximum acceptable detection delay.
2. Keep OAuth credentials in owner-only files or protected secret storage; never request or print tokens in chat.
3. Keep raw chat text, raw lyrics, individual message vectors, and query vectors memory-only. Persist only public song metadata, derived lyric attributes, versioned song vectors, health state, and aggregate provenance.
4. Treat mood output as an estimate, never a diagnosis. Require explicit text evidence for severe or sensitive labels.
5. Confirm Spotify platform-policy compatibility before offering the workflow to third-party customers; owner consent does not replace provider terms.

**Complete when:** the data-flow contract identifies every source, transient value, persisted value, destination, and retention rule.

## 2. Authorize Spotify with PKCE

1. Use Authorization Code with PKCE and only the scopes needed for Recently Played, Saved Tracks, and any explicitly requested library surfaces.
2. Bind the callback to loopback, verify `state`, and exchange the code without a client secret.
3. Atomically write the token file with mode `0600`; retain a rotated refresh token when Spotify returns one.
4. Prove both `GET /v1/me/player/recently-played` and `GET /v1/me/tracks` with bounded responses. On HTTP 401, attempt one refresh and retry once.
5. When refresh returns an authorization error, classify it as requiring human reauthorization rather than retrying indefinitely.

**Complete when:** both APIs return valid bounded payloads and no credential appears in process arguments, logs, or output.

## 3. Collect recommendation inputs

1. Collect the exact recent-listening window and preserve play timestamps, canonical track title, artist, and album only as needed.
2. Fetch a bounded Saved Tracks slice for candidate selection. Do not log library contents.
3. Collect owner-authorized mood signals. Embed raw owner chat messages only with a private local model, filter media and known automation posts, cap message count and length, and discard text and vectors after aggregation.
4. Build a structured mood/music profile covering emotional trajectory, energy, valence, focus, sociality, tempo feel, tonal feel, rhythm, texture, dynamics, instrumentation, and genre neighborhood.
5. Normalize the recency-weighted chat vector and blend it with the structured profile vector using an explicit, tested weight.

**Complete when:** the run produces one ephemeral query vector and bounded recent/listening-library inputs without persisting private semantic material.

## 4. Produce and verify the candidate pool

1. Generate or retrieve exactly eight unique candidates outside the current rotation.
2. Require exactly four candidates from the verified Saved Tracks set and four discovery candidates outside that set. Verify membership in code; never trust a model-supplied source label.
3. Exact-match title and compatible artist against a public catalog such as MusicBrainz.
4. Ground lyrical characteristics through a licensed or permitted source. Keep raw lyrics transient; retain only bounded derived themes, perspective, intensity, repetition, word count, and a non-reversible hash when caching is needed.
5. Reject duplicates, current-rotation tracks, mismatches, missing genres, missing lyric grounding, and incomplete fields.

**Complete when:** the candidate pool is independently verified as four Saved Tracks plus four discovery tracks, or the run fails closed.

## 5. Embed, cache, and rank songs

1. Create each song document from canonical title/artist, catalog metadata, genres/tags, lyric-derived semantics, production character, and intended mood transition.
2. Use one embedding model and version for both query and song documents. Validate exact vector count, dimension, finite values, and nonzero norms.
3. Cache only normalized song vectors. Key entries by canonical recording ID, model ID/version, document hash, and optional audio-feature version; invalidate on any key change.
4. Never cache mood, chat, or blended query vectors.
5. Search cached vectors by cosine similarity or ANN, then apply recent-play, duplicate, availability, and grounding filters. Deterministically rerank ties.
6. If using audio embeddings, score them within their own model space and combine normalized scores; never cosine-compare vectors from unrelated models.

**Complete when:** repeated runs reuse song vectors, recompute only the private query vector, and return deterministic grounded recommendations.

## 6. Render and deliver safely

1. Label each recommendation as `Spotify Liked Songs` or `Discovery` from verified membership.
2. Display only safe fields: title, artist, genres, public catalog provenance, lyric-derived characteristics, mood fit, and rounded similarity.
3. Never display raw lyrics, raw chat, private-message paraphrases, identifiers, or vectors.
4. Use one idempotent relay state with a unique sequence. Route delivery only to the approved destination through the sole active messaging listener.
5. Verify application success, relay state advancement, transport acknowledgement, and rendered media integrity.

**Complete when:** the exact delivered artifact is readable, privacy-safe, and acknowledged by the intended provider/destination.

## 7. Supervise OAuth continuously

1. Run a lightweight probe at least every minute against both Recently Played and Saved Tracks.
2. On HTTP 401, perform one bounded refresh and one retry. Avoid service or Gateway restart loops.
3. Mark the first failure `suspect`; mark two consecutive failures `unhealthy`.
4. Emit one deduplicated failure alert on the transition to unhealthy and one recovery alert on the first later success.
5. Continue recommendations from other available sources during Spotify degradation; expose the missing source honestly.
6. Persist only mode-`0600` health state: status, safe reason code, consecutive failures, timestamps, latency, and pending alert metadata.
7. Measure probe cadence plus alert-relay cadence. Describe the result as a detection/alert SLO, not a guaranteed repair SLO, because revoked consent requires human authorization.

**Complete when:** injected failure and recovery transitions alert exactly once each, normal probes remain silent, and measured detection plus relay pickup stays within the declared objective.

## 8. Verify the complete system

Run focused tests for PKCE/state validation, token rotation, response bounds, candidate membership, exact matching, privacy exclusions, malformed vectors, deterministic ranking, cache invalidation, health transitions, alert deduplication, and recovery. Then run one live owner-authorized proof and inspect the delivered artifact and provider acknowledgement.

**Complete when:** tests pass, no secret/private semantic data appears in files or logs, health supervision is enabled, and one end-to-end delivery is independently proven.

## Failure boundaries

- Never infer that an empty listening window means OAuth is healthy; probe the APIs directly.
- Never retry revoked authorization indefinitely or claim silent repair.
- Never restart unrelated services to repair Spotify.
- Never broaden network access for a health check.
- Never publish private hostnames, IPs, tokens, chat destinations, or personal library contents in a reusable skill or public article.
