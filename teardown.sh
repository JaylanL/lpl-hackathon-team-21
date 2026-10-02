#!/usr/bin/env bash
# Deletes everything deploy.sh created (stack, buckets' contents, artifacts bucket).
set -uo pipefail
REGION="${AWS_REGION:-us-east-1}"; export AWS_DEFAULT_REGION="$REGION"
STACK="advisor-match"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null; }
for B in "$(out DataBucketName)" "$(out WebBucketName)"; do
  [ -n "$B" ] && [ "$B" != "None" ] && aws s3 rm "s3://$B" --recursive --only-show-errors
done
# buckets from a failed/rolled-back stack may not be in outputs; empty any stack buckets by physical id
for B in $(aws cloudformation list-stack-resources --stack-name "$STACK" --query "StackResourceSummaries[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId" --output text 2>/dev/null); do
  aws s3 rm "s3://$B" --recursive --only-show-errors 2>/dev/null
done
aws cloudformation delete-stack --stack-name "$STACK"
echo "Deleting stack (CloudFront can take ~5-10 min)..."
aws cloudformation wait stack-delete-complete --stack-name "$STACK" && echo "Stack deleted."
aws s3 rb "s3://advisor-match-artifacts-${ACCOUNT}-${REGION}" --force >/dev/null 2>&1 && echo "Artifacts bucket deleted."
