# Search & Discover Contracts

The canonical Search & Discover contracts are Pydantic models in `apps/engine/backend/search/models.py`. The generation script produces the shared JSON Schema and frontend TypeScript types from those models.

Generated files carry a warning and must not be edited by hand.

Run the following commands from the repository root after activating the backend virtual environment and installing `apps/engine/backend/requirements.txt`. Generation intentionally rejects Pydantic versions that differ from the repository pin.

## Generated Artifacts

| Artifact | Purpose |
| --- | --- |
| `modules/search/search-contract.schema.json` | Language-neutral JSON Schema for validation and review |
| `apps/shell/frontend/src/types/search.ts` | TypeScript request, response, and result types used by React |
| `modules/search/examples/*.json` | Validated examples for requests, responses, partial success, and errors |

Generate or update the artifacts:

```bash
python scripts/generate-search-contracts.py
```

Fail when committed artifacts differ from the Pydantic models:

```bash
python scripts/generate-search-contracts.py --check
```

Validate the generated files, examples, and core rejection rules:

```bash
python scripts/validate-search-contracts.py
```

## Result Types

All raw search results contain these common fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable NEXUS identifier derived from result kind and canonical URL |
| `kind` | Required discriminator: `web`, `image`, or `video` |
| `title` | Human-readable provider title after normalization |
| `url` | Original page or destination URL presented to the user |
| `source_name` | Human-readable source or site name |
| `attribution` | Optional provider or creator attribution required for display |

### Web Results

`WebSearchResult` adds a text snippet and an optional publication timestamp.

### Image Results

`ImageSearchResult` adds media and thumbnail URLs, optional dimensions, MIME type, and alternative text. Its common `url` field points to the webpage where the image was found, not directly to the image file.

### Video Results

`VideoSearchResult` adds optional thumbnail, creator, duration, publication timestamp, and embedding metadata. `embed_url` is valid only when `embeddable` is `true`. NEXUS links to or embeds provider-hosted media; it does not download video files into the contract.

### Article Documents

`ArticleDocument` is separate from `SearchResult`. It represents readable text extracted from a user-selected public page. It cannot appear in raw search-result lists.

AI-generated answers are also separate from raw results. An answer contract will be introduced only when cited answer generation is implemented.

## Request Limits

| Limit | Value |
| --- | ---: |
| Maximum query length | 500 characters |
| Default results per kind | 10 |
| Maximum results per kind | 20 |
| Maximum mixed results | 60 |
| Maximum cursor length | 2,048 characters |
| Maximum URL length | 2,048 characters |

Whitespace around string fields is stripped before validation. Unknown fields are rejected. Query text must contain at least one non-whitespace character.

`safe_search` accepts `off`, `moderate`, or `strict` and defaults to `moderate`. Providers must map these values to the closest supported behavior and document any loss of fidelity.

`locale` is an optional provider-neutral locale hint. A provider may fall back to its default locale, but it must not rewrite the requested locale in the public response.

## Pagination

Cursors are opaque values owned by provider adapters:

- React and agent tools may store and return a cursor but must not parse it.
- A cursor applies only to the same provider, query, result kind, locale, and safe-search mode that created it.
- Single-kind responses use `page`.
- Mixed responses use independent `pages.web`, `pages.image`, and `pages.video` values.
- `next_cursor` may be present only when `has_more` is `true`.
- Provider changes may invalidate existing cursors. Invalid cursors return `invalid_request` rather than silently restarting at page one.

## Mixed Search and Partial Success

`MixedSearchRequest.kinds` must contain one to three unique result kinds. `per_kind_limit` applies separately to every requested kind.

When at least one requested kind succeeds, mixed search returns a normal response. A failed kind contributes a `SearchWarning` containing:

- A stable error code
- A safe user-facing message
- The failed result kind
- Whether retrying may succeed
- An optional retry delay

Valid results are never discarded because another result kind failed. A successful empty result set is not an error and does not require a warning.

When all requested kinds fail, the endpoint returns `SearchErrorResponse` rather than an empty successful response.

## Error Codes

| Code | Meaning | Normally retryable |
| --- | --- | --- |
| `invalid_request` | Input failed validation or contains an invalid cursor | No |
| `authentication_failed` | The local sidecar session credential is missing or invalid | No |
| `service_starting` | The sidecar has not completed startup | Yes |
| `service_unavailable` | The sidecar or required subsystem is unavailable | Yes |
| `provider_not_configured` | Required provider credentials or configuration are missing | No |
| `provider_timeout` | The provider exceeded its request deadline | Yes |
| `provider_rate_limited` | The provider rejected the request because of quota or rate limits | Yes |
| `provider_failure` | The provider returned an unusable or unexpected failure | Usually |
| `unsafe_url` | Article retrieval rejected the destination | No |
| `unsupported_content` | The resource is not a supported article format | No |
| `content_too_large` | The resource exceeded a configured size limit | No |
| `extraction_failed` | Readable article content could not be extracted | Usually no |

Provider messages, stack traces, credentials, and raw response bodies do not appear in public error messages.

## URL Canonicalization and Stable IDs

Provider adapters preserve the user-facing source URL while computing a separate internal canonical form for identity and deduplication.

Canonicalization applies these rules in order:

1. Parse the URL and require a supported HTTP scheme.
2. Lowercase the scheme and host.
3. Normalize internationalized hostnames to their ASCII representation.
4. Remove the fragment.
5. Remove default ports.
6. Normalize an empty path to `/` and resolve path dot segments.
7. Preserve query parameter names, values, repetitions, and order.

The initial implementation does not remove tracking parameters because a generic rule could alter resource identity. Provider-specific tracking cleanup may be added only with fixtures proving that it is safe.

A stable result ID uses this format:

```text
<kind>_<first 16 hexadecimal characters of SHA-256(kind + NUL + canonical_url)>
```

Deduplication occurs within each result kind. When duplicates are found, the highest-ranked result retains its position and may receive missing optional metadata from lower-ranked duplicates. Results of different kinds remain distinct even when they share a destination URL.

## Response Envelopes

Every successful search response includes:

- `request_id`
- The normalized `query`
- `warnings`, including an empty array when no warnings occurred
- `duration_ms`
- Typed `results`
- Pagination information

Article responses use the same operational fields but contain one `article` instead of search results.

Timestamps use ISO 8601 strings with timezone information. Durations are non-negative integer milliseconds.

## AI Tool Mapping

Agent tools call the Python services directly and reuse these contracts:

| Tool | Input | Output |
| --- | --- | --- |
| `search_web` | `WebSearchRequest` | `WebSearchResponse` |
| `search_images` | `ImageSearchRequest` | `ImageSearchResponse` |
| `search_videos` | `VideoSearchRequest` | `VideoSearchResponse` |
| `fetch_article` | `ArticleFetchRequest` | `ArticleFetchResponse` |

Tool adapters may reduce result counts or truncate article text to fit model context. They must preserve IDs, kinds, titles, source URLs, attribution, warnings, and error codes. Tool adapters cannot add provider-specific fields or bypass service validation.

All provider text, article text, media metadata, and URLs remain untrusted when passed to an AI model.

## Contract Evolution

Additive optional fields are backward-compatible. Removing fields, changing meanings, adding required fields, or changing discriminator values requires a documented contract version change.

Contract changes follow this sequence:

1. Update the Pydantic models.
2. Regenerate JSON Schema and TypeScript.
3. Update or add examples.
4. Run contract validation.
5. Update endpoint and consumer tests.
