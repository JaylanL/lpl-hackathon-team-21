# LPL Advisor Matching Assistant — Technical Specification

## Context

LPL Financial's current advisor directory requires tedious, item-by-item manual searching. This specification defines an accessible, low-friction AI matching assistant — a serverless, conversational intake system that collects user preferences and matches them to suitable human advisors. The assistant acts strictly as an intake/matching layer: it never offers direct investment advice (SEC/FINRA compliance boundary).

## 1. High-Level Architecture & Data Flow

```
[S3 static site + CloudFront]
  - Web Speech API STT/TTS (client-side only)
  - glossary tooltip engine
        | HTTPS / WebSocket
        v
[API Gateway: REST + WebSocket]
        v
[Lambda: intake-orchestrator]  <- hot path, synchronous
  - loads session (DynamoDB)
  - Bedrock Converse/ConverseStream + guardrailConfig
  - glossary term-tagging pass
  - advisor-matcher (inline module) once intake complete
  - persists session, returns structured JSON
        |
        +--> DynamoDB: AdvisorIntakeSessions
        +--> DynamoDB: AdvisorProfiles
        +--> DynamoDB: GlossaryTerms
        +--> Bedrock Runtime (Converse + Guardrail)
```

### Lambda functions (4)

| Function | Trigger | Role |
|---|---|---|
| `session-init` | `POST /session` | Creates session item, returns `sessionId`. No LLM call. |
| `intake-orchestrator` | `POST /session/{id}/message` (or WebSocket) | Hot path: loads history, calls Bedrock, applies guardrail, tags glossary terms, persists turn, returns response. |
| `advisor-matcher` | invoked inline from orchestrator | Deterministic (non-LLM) filter/rank over `AdvisorProfiles` once intake preferences are complete — auditable, no hallucination risk. |
| `glossary-admin` | internal/back-office API | CRUD for glossary + advisor data; separate stage, IAM/Cognito-admin protected. |

### Sync vs. streaming

Chat turn is a synchronous Lambda invocation (API Gateway proxy, <29s budget). Recommend a WebSocket API + Bedrock `ConverseStream` for progressive token rendering (pairs well with TTS); REST non-streaming is an acceptable MVP fallback. Guardrail `streamProcessingMode: sync` (not async) — a compliance violation must never reach the user, even partially.

### Voice I/O

Entirely client-side (`SpeechRecognition` STT, `speechSynthesis` TTS). The backend only ever sees/returns text — no audio payloads, smaller PII surface, simpler API contract. `preferredLanguage` (BCP-47) is stored as a session attribute and drives both LLM response language and STT/TTS locale. Known risk: Web Speech API STT has inconsistent/absent support (e.g., Firefox) — typed input must always remain available as a fallback.

### Session flow

`sessionId` is client-held (header/path param); Lambdas are fully stateless. Each turn re-reads a bounded `conversationHistory` + `collectedPreferences`, calls Bedrock with Converse `toolConfig` to extract structured slot-filling JSON alongside the natural-language reply, and merges it into `collectedPreferences` with optimistic-lock (`version` attribute) conditional writes. Once required slots are filled (services needed, language, communication mode, geography, investable-assets band — collected as *stated preferences*, never advised upon), the matcher runs and returns candidates in the same payload. Session TTL is 24–48h (DynamoDB TTL attribute) to minimize retained PII.

### Auth (flag for decision)

Cognito Identity Pool for anonymous-but-tracked sessions at MVP; upgradable to a full User Pool login if the matched-advisor handoff needs to bind to an authenticated LPL identity.

## 2. DynamoDB Schema

Three separate tables, not single-table design. Sessions (ephemeral, PII-bearing, TTL'd), Advisor Profiles (low-write/high-read, admin-managed, needs multi-attribute filtering), and Glossary (near-static reference data) have different lifecycles, access patterns, and compliance/retention needs. The application layer already does the "join" via Lambda, not DynamoDB transactions — single-table design would add complexity without benefit here.

### `AdvisorIntakeSessions`

| Attr | Type | Notes |
|---|---|---|
| PK | S | `SESSION#<uuid>` |
| SK | S | `META` |
| ttl | N | DynamoDB TTL, epoch seconds |
| status | S | `IN_PROGRESS` / `MATCHED` / `ABANDONED` |
| preferredLanguage | S | BCP-47 |
| conversationHistory | L | bounded list of `{role, content, ts}` |
| collectedPreferences | M | servicesNeeded, investableAssetsBand, communicationMode, languagePref, geography, accessibilityNeeds |
| matchedAdvisorIds | L(S) | |
| version | N | optimistic lock |
| complianceFlags | L | audit cross-reference, e.g. `GUARDRAIL_TRIGGERED:turn_7` |

No GSI — always accessed by `sessionId`.

### `AdvisorProfiles`

| Attr | Type | Notes |
|---|---|---|
| PK | S | `ADVISOR#<id>` |
| SK | S | `PROFILE` |
| specialties, languages, communicationModes, credentials | SS | |
| minInvestableAssets | N | |
| geography | M | `{state, servesRemote}` |
| availabilityStatus | S | `ACCEPTING` / `WAITLIST` / `CLOSED` |
| active | BOOL | soft-delete |

- **GSI1** `AvailabilityIndex`: PK=`availabilityStatus`, SK=`advisorId` — cheap fetch of all "ACCEPTING" advisors, then filter specialty/language/geo in Lambda (advisor counts are hundreds–low thousands; not a multi-attribute-DynamoDB-query problem).
- **GSI2** `GeoIndex`: PK=`geography.state`, SK=`availabilityStatus#advisorId`.
- Future scaling note: if advisor count/filter complexity grows substantially, migrate advisor search to OpenSearch — not an MVP requirement.

### `GlossaryTerms`

| Attr | Type | Notes |
|---|---|---|
| PK | S | `TERM#<slug>` e.g. `TERM#fiduciary` |
| SK | S | `LANG#<locale>` — one item per term per language |
| displayTerm, definition | S | 8th-grade reading level, ≤~40 words, compliance-reviewed per language |
| category | S | |
| audioHint | S | TTS pronunciation guide (e.g. "AUM" → "A-U-M") |
| lastReviewedBy | S | compliance sign-off trail |

No GSI. Read-heavy, near-static — cache (DAX, or an in-Lambda cache / client bulk-fetch-once) rather than per-message DynamoDB reads.

## 3. Plain-Language UI Pattern

### Detection — hybrid (server tags, client renders)

Pure client-side regex against jargon is unreliable (overlapping terms, pluralization, multilingual tokenization). `intake-orchestrator` runs a deterministic longest-match/trie tagger (cached glossary term list) over the LLM's response text and returns:

```json
{
  "text": "...",
  "glossaryTags": [
    {"term": "fiduciary", "start": 42, "end": 51, "termId": "TERM#fiduciary"}
  ]
}
```

Character offsets let the client wrap exact spans without re-parsing.

### Rendering

Wrap tagged spans in a `<button aria-describedby="tip-x" aria-expanded="false">` (not a bare `<span>` — natively focusable/actionable) paired with a `role="tooltip"` element, following the WAI-ARIA APG Tooltip pattern: shown on hover/focus/tap, dismissible via `Escape`, persistent and hoverable per WCAG 1.4.13 (never a hover-dismiss-on-mouse-move or auto-timeout). Positioned via floating-UI/CSS anchor so it never reflows surrounding text. No `title` attribute (inaccessible on touch, inconsistent screen-reader support). Touch targets ≥44×44px (WCAG 2.5.5).

### Multilingual

Response carries `termId`s only; the client resolves the localized definition from a once-per-session cached glossary bundle for `preferredLanguage`. Definitions are pre-translated and compliance-reviewed per language in the `GlossaryTerms` table — never translated on-the-fly by the LLM at request time.

## 4. Accessibility & Guardrail Verification Strategy

### Compliance guardrail — defense in depth, not one control

1. **System prompt** — explicit "intake/matching only, never advice" framing with redirect phrasing. Necessary, not sufficient alone (steerable by adversarial input).
2. **Amazon Bedrock Guardrails** — custom Denied Topic `direct_investment_advice` with example phrases; applied via `guardrailConfig` on every Converse/ConverseStream call; pinned guardrail version in production (never DRAFT); IAM policy requires `bedrock:GuardrailIdentifier` condition on `InvokeModel*` so code can't bypass it; streaming uses `sync` guardrail mode; PII filters (`BLOCK` for SSN/account numbers, `ANONYMIZE` for lower-sensitivity data).
3. **Secondary check** — MVP: deterministic keyword/regex scan on outputs as a last-resort net. Phase 2: standalone second `ApplyGuardrail` pass for two independent evaluations.
4. **Audit trail** — Bedrock invocation logging to a KMS-encrypted CloudWatch Log Group (trace disabled in production to avoid leaking matched spans into API responses, but the guardrail *action* is logged); retention aligned to FINRA Rule 4511-style record-retention (confirm exact duration with LPL compliance/legal); CloudTrail alarm on any `CreateGuardrailVersion`/`UpdateGuardrail` change; recurring (nightly/weekly) compliance-review job surfacing flags/blocks and conversation samples for human review.

### WCAG 2.1 AA verification

- **Automated**: axe-core in CI (catches ~30–40% of issues — not sufficient alone) on landing/chat/results/tooltip-open states.
- **Manual**: full WCAG-EM pass pre-launch, focused on `aria-live="polite"` (never `assertive`) for streamed responses, focus management on new match cards, and the §3 tooltip pattern's 1.4.13 compliance.
- **Screen readers**: NVDA+Chrome, VoiceOver+Safari, TalkBack+Chrome — including voice-input-while-screen-reader-active (known conflict risk).
- **Contrast/zoom**: axe + manual 200% zoom check (1.4.4).
- **External audit**: VPAT/Section 508-aligned audit before enterprise go-live — the formal artifact LPL's legal/accessibility office will require.

### Multilingual voice testing

Per-locale STT/TTS accuracy tested against a fixed financial-jargon script across the three browser/OS combinations above; Web Speech API locale gaps documented as a risk-register item with typed-input fallback as mitigation; compliance sign-off per language on glossary definitions; explicit mid-conversation language-switch test case (session `preferredLanguage` update propagates to LLM responses, glossary lookups, and TTS voice selection).
