import os
import sys

import boto3
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError
from dotenv import load_dotenv


def main() -> int:
    load_dotenv()

    profile = os.getenv("AWS_PROFILE") or None
    region = os.getenv("AWS_REGION", "us-east-1")

    try:
        session = boto3.Session(profile_name=profile, region_name=region)
        identity = session.client("sts").get_caller_identity()
    except (BotoCoreError, ClientError, NoCredentialsError) as exc:
        print("AWS SDK credentials check failed.")
        print(exc)
        return 1

    print("AWS SDK credentials are working.")
    print(f"Account: {identity.get('Account')}")
    print(f"Arn: {identity.get('Arn')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
