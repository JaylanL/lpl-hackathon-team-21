"""Seed ~40 synthetic (fictional) advisors with Titan embeddings into the data bucket.

Usage: python3 seed.py <data-bucket> [region]
All names are invented demo data, not real advisors.
"""
import json
import random
import sys

import boto3

bucket = sys.argv[1]
region = sys.argv[2] if len(sys.argv) > 2 else "us-east-1"
br = boto3.client("bedrock-runtime", region_name=region)
s3 = boto3.client("s3", region_name=region)
random.seed(7)

FIRST = ["Maya", "Luis", "Priya", "James", "Ana", "Kevin", "Grace", "Omar", "Elena", "Marcus",
         "Dana", "Tomas", "Aisha", "Ben", "Carmen", "Derek", "Lena", "Victor", "Nora", "Isaac"]
LAST = ["Rivera", "Chen", "Patel", "Brooks", "Nguyen", "Okafor", "Silva", "Kim", "Hughes", "Diaz",
        "Moreno", "Walsh", "Reyes", "Foster", "Lam", "Castillo", "Grant", "Ortiz", "Bell", "Shah"]
FOCUS = [
    "young professionals and first-time investors",
    "first-time home buyers",
    "student loan payoff and early retirement saving",
    "new parents and college savings",
    "small business owners",
    "pre-retirees and retirement income",
    "inheritance and estate transitions",
    "tech employees with equity compensation",
    "military families",
    "teachers and public-sector pensions",
]
CITIES = [("Charlotte, NC", "28202"), ("San Diego, CA", "92101"), ("Austin, TX", "78701"),
          ("Boston, MA", "02110"), ("Fort Mill, SC", "29715"), ("Miami, FL", "33130")]


def embed(text):
    r = br.invoke_model(modelId="amazon.titan-embed-text-v2:0",
                        body=json.dumps({"inputText": text, "normalize": True}))
    return json.loads(r["body"].read())["embedding"]


advisors = [
    # Pinned demo advisors so the golden-path demo always has a great match.
    {"advisor_id": "adv-901", "name": "Sofia Ramirez", "city": "Miami, FL", "zip": "33130",
     "languages": ["English", "Spanish"], "meeting_types": ["virtual", "in-person"],
     "focus": ["young professionals and first-time investors", "first-time home buyers"], "open_slots": 5,
     "bio": "Bilingual (English/Spanish). Specializes in first-time investors and saving for a first home. "
            "Patient, jargon-free, offers evening virtual meetings."},
    {"advisor_id": "adv-903", "name": "Mei Lin", "city": "San Diego, CA", "zip": "92101",
     "languages": ["English", "Mandarin"], "meeting_types": ["virtual", "in-person"],
     "focus": ["young professionals and first-time investors", "first-time home buyers"], "open_slots": 5,
     "bio": "Bilingual (English/Mandarin). Helps first-time investors and families new to the US financial system. Patient and jargon-free."},
    {"advisor_id": "adv-902", "name": "Jordan Ellis", "city": "Charlotte, NC", "zip": "28202",
     "languages": ["English"], "meeting_types": ["virtual"],
     "focus": ["student loan payoff and early retirement saving", "young professionals and first-time investors"],
     "open_slots": 4,
     "bio": "Works with recent grads balancing student loans, a first 401(k) and building savings. "
            "Education-first and plain-language."},
]
used = {a["name"] for a in advisors}
i = 0
while len(advisors) < 42:
    name = f"{random.choice(FIRST)} {random.choice(LAST)}"
    if name in used:
        continue
    used.add(name)
    focus = random.sample(FOCUS, 2)
    city, zipc = random.choice(CITIES)
    langs = ["English"] + (["Spanish"] if random.random() < 0.35 else []) + (["Mandarin"] if random.random() < 0.1 else [])
    advisors.append({
        "advisor_id": f"adv-{i:03d}", "name": name, "city": city, "zip": zipc, "languages": langs,
        "meeting_types": random.choice([["virtual"], ["in-person"], ["virtual", "in-person"]]),
        "focus": focus, "open_slots": random.randint(0, 6),
        "bio": f"Works mostly with {focus[0]} and {focus[1]}. Plain-language, patient, education-first.",
    })
    i += 1

for n, a in enumerate(advisors, 1):
    a["embedding"] = embed(f"{a['bio']} Focus: {', '.join(a['focus'])}. Languages: {', '.join(a['languages'])}.")
    print(f"\rembedded {n}/{len(advisors)}", end="", flush=True)

s3.put_object(Bucket=bucket, Key="advisors.json", Body=json.dumps(advisors).encode())
print(f"\nseeded {len(advisors)} advisors to s3://{bucket}/advisors.json")
