# Advisor Match: AWS agentic stack

Strands agent on Amazon Bedrock (Claude + Guardrails), Lambda Function URL, S3 + CloudFront web app,
DynamoDB, Cognito guest credentials + Transcribe streaming (voice), Polly (read-aloud).

## Deploy (AWS CloudShell, us-east-1)
1. Open CloudShell in the AWS console (us-east-1). Actions > Upload file > advisor-match.zip
2. Run:
   unzip -o -q advisor-match.zip && cd advisor-match && bash deploy.sh
3. Open the Web app URL printed at the end.

Re-run `bash deploy.sh` after any change. `RESEED=1 bash deploy.sh` regenerates demo advisors.
`bash teardown.sh` deletes everything.

## Edit
- Agent prompt and tools: backend/lambda_function.py
- Demo advisors: seed/seed.py (all fictional)
- Web app: web/src (Vite). After edits: cd web && npm install && npm run build, then bash deploy.sh
- Infrastructure: template.yaml

## API (Function URL)
<<<<<<< Updated upstream
POST /chat {message, session_id?, simple?}; POST /speak {text, lang}; POST /metrics; POST /bookings; GET /health
=======
POST /chat {message, session_id?, simple?, selected_advisor_id?}; POST /speak {text, lang}; POST /metrics {range?, start_date?, end_date?}; POST /insights {funnel}; POST /bookings;
POST /advisors {language?, meeting_type?, text?} (full advisor list for the "All advisors" tab); GET /health

The Business dashboard uses the Lambda-backed `/insights` route for prioritized actions and exports selected reports as CSV. CSV reports can be imported into Amazon QuickSight for richer visualization. Embedded QuickSight dashboards require an account-specific dashboard, permissions, and embed identity, so this prototype keeps visualization in the app and provides a QuickSight-ready export.

## Architecture skills
The coding-agent skills are in `skills/` (from `test1`); how each one maps onto this app: docs/skills-applied.md.
AWS SDK credentials check: `pip install -r requirements.txt && python scripts/check_aws_sdk.py`
>>>>>>> Stashed changes
