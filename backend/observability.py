"""SKILL-12: structured JSON logs and CloudWatch Embedded Metric Format (EMF) metrics.

Printing an EMF document to stdout in Lambda creates a CloudWatch metric with no extra API calls.
"""
import json
import time

NAMESPACE = "AdvisorMatch"


def emit_metric(name, value=1, unit="Count", namespace=NAMESPACE, **dimensions):
    dimensions = {k: str(v) for k, v in (dimensions or {"Service": "agent"}).items()}
    print(json.dumps({
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [{
                "Namespace": namespace,
                "Dimensions": [list(dimensions)],
                "Metrics": [{"Name": name, "Unit": unit}],
            }],
        },
        **dimensions,
        name: value,
    }))


def log(event, **fields):
    print(json.dumps({"level": fields.pop("level", "INFO"), "event": event, **fields}, default=str))
