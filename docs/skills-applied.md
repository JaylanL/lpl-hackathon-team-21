# Skills applied to the Advisor Match web app

The `test1` branch defines 12 coding-agent skills (`skills/skill-01` … `skill-12`). This branch applies
them to the existing app (Strands agent Lambda + CloudFormation + Vite web app) **without changing the
CloudShell deploy flow**: `bash deploy.sh` still deploys everything.

```
Browser (S3 + CloudFront)
  └─ POST /chat ─► Agent Lambda (Strands + Bedrock Guardrail, X-Ray traced)
                     ├─ PII screen (blocked text never reaches the model)          SKILL-01
                     ├─ record_preferences ─► DynamoDB intake table (24h TTL)       SKILL-01
                     ├─ search_advisors ─► Titan embeddings + AHP ranking           SKILL-02/03
                     │                    └─ match reasons + fee disclosure         SKILL-04
                     ├─ book_meeting (only advisor IDs search returned)            SKILL-02
                     └─ create_advisor_briefing ─► EventBridge bus                  SKILL-05/10
                                                      └─ SQS (+DLQ) ─► CRM sync Lambda
                                                                        ├─ S3 crm-outbox/<booking>.json
                                                                        ├─ optional webhook (retry + backoff)
                                                                        └─ booking.crm_status = synced
  KMS customer managed key on DynamoDB, data bucket, SQS                            SKILL-08
  EMF metrics, alarms -> SNS, monthly budget, 30-day log retention                  SKILL-12
```

| Skill | What it became here | Where |
| --- | --- | --- |
| 01 behavioral_intake_crs | 7 intake slots filled by a `record_preferences` tool, progress bar in the UI, zero-upfront-PII screen (SSN, card, email, phone, street address) answered in the user's language, intake state and chat sessions expire after 24h | `backend/matching.py`, `backend/lambda_function.py`, `template.yaml` (IntakeTable TTL, S3 lifecycle) |
| 02 agentic_rag_kg_retrieval | Zero out-of-inventory risk: `book_meeting` rejects any `advisor_id` the retrieval step did not return for this session; prompt forbids inventing advisors | `matching.is_known_advisor`, `book_meeting` |
| 03 mcdm_ahp_scoring_engine | Ranking uses AHP weights (Saaty 1-9 matrix, principal eigenvector, CI/CR, fallback if CR > 0.10) over expertise fit, language, meeting type, availability; the user's stated top priority reshapes the weights; weights + CR logged for audit | `matching.ahp_weights`, `matching.rank_advisors` |
| 04 explainable_match_generator | Each match card shows a match %, "Why this match" reasons, what the ranking weighed most, and how the advisor is paid (fee model + SAM/MWP platform) plus the Form CRS note, in English/Spanish/Mandarin | `matching.match_reasons`, `matching.fee_disclosure`, `web/src/main.js`, `seed/seed.py` |
| 05 crm_sync_scheduling_agent | PII captured only at booking (first name). Booking publishes `ClientConsultationBooked`; the CRM consumer writes a ClientWorks-shaped record and marks the booking synced (shown in the Advisor view) | `backend/crm_sync.py` |
| 06 portfolio_opt_harmonizer | **Not applied on purpose.** The app's guardrail forbids allocation advice; adding mean-variance optimization would break that compliance boundary | — |
| 07 aws_agentic_ai_toolset_setup | Guardrail interventions detected (`stop_reason == guardrail_intervened`), stored as compliance flags, counted on the dashboard and as a metric | `lambda_function.chat` |
| 08 aws_cdk_foundation_bootstrap | Applied in CloudFormation (the team deploys from CloudShell, no CDK toolchain): KMS CMK with rotation, least-privilege roles per function, no hard-coded account IDs. VPC skipped: no private resources, NAT would add cost | `template.yaml` |
| 09 aws_serverless_microservice_deploy | Pydantic request validation (400 with a readable message), X-Ray active tracing, structured JSON logs | `lambda_function.py`, `template.yaml` |
| 10 aws_event_driven_pipeline_orchestration | Custom EventBridge bus -> SQS with dead-letter queue -> Lambda with partial batch failure reporting | `template.yaml`, `crm_sync.py` |
| 11 aws_containerized_batch_compute | **Not applied.** No workload here needs batch compute | — |
| 12 aws_observability_guardrails_ops | EMF metrics (ChatLatency, MatchLatency, PiiBlocked, GuardrailInterventions, BookingsCreated, OutOfInventoryBlocked, CrmSync*), alarms on errors / p95 latency / DLQ depth / failed booking events, SNS email + monthly budget when `ALERT_EMAIL` is set | `backend/observability.py`, `template.yaml` |

## Testing

```
pip install pydantic pytest boto3
cd backend && python -m pytest -q tests
```
