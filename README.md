# Advisor Match: AWS agentic stack

Strands agent on Amazon Bedrock (Claude + Guardrails), Lambda Function URL, S3 + CloudFront web app,
DynamoDB, Cognito guest credentials + Transcribe streaming (voice), Polly (read-aloud).

## Deploy (AWS CloudShell, us-east-1)
1. Open CloudShell in the AWS console (us-east-1). Actions > Upload file > advisor-match.zip
2. Run:
   unzip -o -q advisor-match.zip && cd advisor-match && bash deploy.sh
3. Open the Web app URL printed at the end.

Re-run `bash deploy.sh` after any change. `RESEED=1 bash deploy.sh` regenerates demo advisors
(run it once after pulling this change so match cards show fee disclosures).
Optional: `ALERT_EMAIL=you@example.com bash deploy.sh` turns on alarm emails and a monthly cost budget.
`bash teardown.sh` deletes everything.

## Edit
- Agent prompt and tools: backend/lambda_function.py
- Ranking, PII screen, match reasons: backend/matching.py (tests: `cd backend && python -m pytest -q tests`)
- Booking -> CRM sync consumer: backend/crm_sync.py
- Demo advisors: seed/seed.py (all fictional)
- Web app: web/src (Vite). After edits: cd web && npm install && npm run build, then bash deploy.sh
- Infrastructure: template.yaml

## API (Function URL)
POST /chat {message, session_id?, simple?}; POST /speak {text, lang}; POST /metrics; POST /bookings; GET /health

## Architecture skills
How the skills on the `test1` branch map onto this app: docs/skills-applied.md
