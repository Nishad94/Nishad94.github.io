---
{
  "title": "Building a Privacy-First Spotify Mood Recommender with Local Embeddings",
  "date": "2026-10-10",
  "description": "How I combined Spotify history, Liked Songs, ephemeral private-message embeddings, grounded song metadata, vector ranking, and one-minute OAuth health checks.",
  "tags": ["Spotify", "OpenClaw", "embeddings", "privacy", "reliability"],
  "draft": false
}
---

Song recommendations look simple until you ask the awkward questions:

- Where do the candidates come from?
- Does the model understand music, or only words about music?
- What happens when Spotify OAuth quietly expires?
- Can private messages improve the mood query without becoming a permanent semantic record?
- Are we actually searching a catalog, or merely reranking a handful of guesses?

I built a private prototype to answer those questions honestly. It combines Spotify Recently Played, Spotify Liked Songs, privacy-bounded mood signals, public catalog metadata, lyric-derived characteristics, local text embeddings, deterministic filtering, and an always-on health plane.

The reusable AgentSkill is published here: [`spotify-mood-recommender/SKILL.md`](/assets/skills/spotify-mood-recommender/SKILL.md).

This is an owner-run research prototype, not a public Spotify service. Before processing Spotify data for other people, review Spotify's current Developer Terms and obtain any permissions the use case requires. User consent alone does not override provider policy.

![Architecture of the private Spotify mood recommendation pipeline](/assets/blog/spotify-mood-recommender-architecture.svg)

## What the system does

Every recommendation cycle builds a private query representing the emotional and musical direction that would fit *next*, not merely the current mood.

Inputs can include:

- Spotify plays from the exact recent window;
- a bounded slice of the owner's Liked Songs;
- a structured mood/music profile;
- owner-authorized chat messages embedded by a private local model;
- coarse activity signals where available.

The output is a small set of grounded recommendations with provenance, similarity scores, and a clear distinction between familiar tracks and discovery tracks.

The important design choice is separation: **song vectors may be cached; private query vectors may not**.

## The query is not just a mood label

A label such as `focused` or `happy` is too lossy for music retrieval. The query profile includes thirteen dimensions:

1. mood summary;
2. desired emotional trajectory;
3. energy;
4. valence;
5. focus;
6. social orientation;
7. tempo feel;
8. tonal feel;
9. rhythm;
10. texture;
11. dynamics;
12. instrumentation;
13. genre neighborhood.

This lets the system express requests such as:

> Preserve concentration, soften tension gradually, keep a clear pulse, avoid abrupt peaks, and stay near layered indie electronic textures.

That document becomes one embedding. It is richer than averaging GloVe vectors over words because a contextual embedding model can represent phrases, negation, and relationships between attributes.

It still does **not** hear notes. A text model knows descriptions *about* tempo, harmony, timbre, and instrumentation; it does not analyze a recording. Audio models such as CLAP or MERT could add a second score later, but their vectors must remain in their own model space.

## Raw chat embeddings, without a permanent semantic archive

The owner explicitly authorized raw owner-written messages as a mood signal. That authorization does not make indefinite storage necessary.

The private-message path is deliberately transient:

1. Read only bounded, owner-sent, non-media messages from the exact window.
2. Exclude known automation posts.
3. Cap both message count and length.
4. Embed each message with a private, self-hosted model.
5. Normalize and aggregate vectors with a recency decay.
6. Blend the aggregate with the structured mood vector.
7. Delete raw text, individual vectors, the aggregate vector, and the blended query after ranking.

The current blend is explicit rather than magical:

```text
query = normalize(
  0.65 × structured_mood_vector
  + 0.35 × recency_weighted_chat_vector
)
```

Only safe provenance survives: dimensions, message count, blend weight, model version, and the statement that private vectors were not persisted.

Embeddings are not anonymization. Even when a vector cannot be casually read, it can retain private semantic structure. That is why the private side remains ephemeral.

## How the eight candidate songs are chosen

The current prototype does **not** compare the query against every song on Spotify.

Today, the reasoning model proposes eight real candidates from the mood/music profile. The system then independently enforces this mix:

- **four verified Spotify Liked Songs**;
- **four discovery songs outside Liked Songs**.

It does not trust a model-supplied `source` field. Title and artist are normalized and checked against the owner's bounded Saved Tracks response. An invalid mix fails closed.

The four-plus-four rule balances familiarity and novelty. It also exposes the current limitation: retrieval quality is bounded by candidate recall. A brilliant song never proposed among the eight cannot win the reranking stage.

The next architecture step is a larger, versioned song-vector corpus:

```text
large cached song corpus
        ↓
retrieve top 50–100 by cosine/ANN
        ↓
recent-play, duplicate, availability and grounding filters
        ↓
richer reranking
        ↓
top recommendations
```

Spotify does not expose a supported "download every track" operation. A realistic private corpus starts with Liked Songs, playlists, listening history, and a permitted public catalog, then grows incrementally.

## Grounding before ranking

Every candidate must survive independent checks before it can receive a score.

### Public catalog verification

MusicBrainz verifies the canonical title, compatible artist, recording identity, duration when available, artist type/geography, and genres or tags.

### Lyric-derived evidence

A permitted lyric source is used for exact title/artist matching. Raw lyrics exist only transiently. The stored and displayed representation is bounded and derived:

- recurring themes;
- narrative perspective;
- emotional-vocabulary intensity;
- refrain repetition;
- word count;
- non-reversible content hash for cache freshness.

No lyric excerpt is needed for retrieval or reporting.

### Musical character

The song document combines:

- canonical song identity;
- public catalog metadata;
- genres and tags;
- lyric-derived semantics;
- text descriptions of energy, rhythm, texture, instrumentation, and dynamics;
- intended emotional transition.

Candidates with mismatches, missing genres, missing lyric grounding, incomplete fields, duplicate identity, or recent-rotation overlap are rejected.

## Contextual text embeddings versus GloVe

Averaging GloVe vectors is inexpensive, but it discards order and most context. "I feel calm" and "I do not feel calm" can become uncomfortably similar after word averaging.

A contextual model such as `nomic-embed-text` embeds the full document. It can better connect:

- "steady energy without an abrupt peak";
- "bright but reflective";
- "preserve focus, then soften";
- lyric themes expressed with different vocabulary.

The prototype uses the same 768-dimensional model and version for both query and song documents. It validates:

- vector count;
- exact dimensions;
- finite values;
- nonzero norms.

Cosine similarity is then straightforward:

```python
def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / ((sum(x*x for x in a) ** 0.5) * (sum(y*y for y in b) ** 0.5))
```

Vectors from unrelated models must never be compared directly. If audio embeddings are added, calculate text similarity and audio similarity separately, normalize the scores, then combine them with measured weights.

## Cache songs, not people

Song documents are comparatively stable and public enough to cache. Mood and private-message vectors are not.

A safe persistent cache key includes:

```text
canonical_recording_id
embedding_model_id
embedding_model_version
document_sha256
audio_feature_version (optional)
```

If any component changes, recompute the vector. Store normalized vectors with strict file permissions and explicit provenance. This makes hourly ranking cheap without creating a permanent private-message embedding store.

The ideal steady state is:

- compute a song vector once;
- reuse it across runs;
- compute one ephemeral private query per window;
- run cosine or approximate-nearest-neighbor search;
- discard the query.

## OAuth health is part of the product

The first production lesson was mundane but important: the report can look healthy while Spotify silently disappears. An empty listening window is ambiguous—it could mean no music, an expired token, a network failure, or a collector defect.

The health plane therefore probes the exact two APIs the product depends on:

- Recently Played;
- Saved Tracks / Liked Songs.

It runs every sixty seconds.

On HTTP 401 it performs exactly one bounded refresh-token attempt and retries once. The state machine is small:

```text
healthy
  ↓ first failure
suspect
  ↓ second consecutive failure
unhealthy ──> one deduplicated alert
  ↓ first later success
healthy ──> one recovery alert
```

Normal probes stay silent. A revoked grant is classified as requiring human reauthorization; it is not hammered with retries or "fixed" by restarting unrelated services.

With a 60-second probe and a 30-second alert relay, a persistent authorization failure should be detected and queued for notification within roughly 60–120 seconds, then picked up within another 30 seconds under healthy infrastructure.

That supports a sub-five-minute **detection and degradation objective**. It is not an honest end-to-end repair guarantee: Spotify can require the person to grant consent again.

## Graceful degradation

Spotify should be one signal, not a single point of failure.

When Spotify is unhealthy:

- the report explicitly omits Spotify evidence;
- other authorized mood signals may continue;
- no stale listening history is presented as current;
- one alert explains that Spotify-backed features are degraded;
- recovery is announced once.

The recommendation system fails closed on evidence while the product fails open on availability.

## Reliability checks that mattered

The focused test matrix includes:

- PKCE challenge and state verification;
- secure token-file permissions;
- refresh-token rotation;
- bounded API responses and pagination;
- exact four-Liked/four-discovery membership;
- duplicate and recent-rotation rejection;
- exact catalog and lyric matching;
- privacy exclusion from JSON, logs, media, and caches;
- malformed, non-finite, zero, and wrong-dimensional vectors;
- deterministic tie-breaking;
- song-cache invalidation;
- first-failure, second-failure, deduplicated alert, and recovery transitions;
- end-to-end media rendering and transport acknowledgement.

The live prototype proved current listening history, verified candidate membership, 768D ranking, privacy-safe rendering, and delivery through an idempotent relay.

## What I would build next

The most valuable next step is not a bigger language model. It is better retrieval.

1. Build a versioned vector corpus from Liked Songs, playlists, history, and permitted catalog sources.
2. Add incremental background embedding with cache hits and model-version invalidation.
3. Retrieve a larger top-K set before grounding and reranking.
4. Add optional audio similarity with a music-specific model, scored separately from text.
5. Collect lightweight feedback—accurate, partly right, wrong—and tune blend/reranking weights.
6. Publish measured availability and recommendation-quality metrics rather than implying certainty.

The pattern generalizes beyond Spotify: cache public or stable objects, keep human context ephemeral, ground model proposals independently, and supervise the authentication surface customers actually depend on.

## Reuse the workflow

The complete reusable procedure is available as an AgentSkill:

- [`SKILL.md`](/assets/skills/spotify-mood-recommender/SKILL.md)
- [`architecture.md`](/assets/skills/spotify-mood-recommender/references/architecture.md)

It intentionally excludes private infrastructure details, credentials, destinations, library contents, and personal messages. Use it as a runbook, then adapt the scopes, data sources, policy review, and reliability objective to your own environment.
