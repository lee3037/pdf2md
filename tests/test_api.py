import json
import os
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("STRATUM_WORKERS", "1")

from fastapi.testclient import TestClient  # noqa: E402

from app.server import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def wait_done(client, job_id, timeout=180):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.3)
    raise TimeoutError(job_id)


def test_convert_rechunk_and_errors(client):
    pdf = ROOT / "samples" / "complex_cn.pdf"
    with open(pdf, "rb") as f:
        r = client.post("/api/jobs", files={"file": ("预算.pdf", f, "application/pdf")},
                        data={"options": json.dumps({"separator": "@@@", "max_chars": 800})})
    assert r.status_code == 200, r.text
    job = wait_done(client, r.json()["id"])
    assert job["status"] == "done", job
    res = job["result"]
    assert "@@@" in res["markdown"] and res["stats"]["chunks"] == len(res["chunks"])
    assert all(c["chars"] <= 800 for c in res["chunks"])

    r2 = client.post(f"/api/jobs/{job['id']}/rechunk", json={"options": {"table_mode": "kv", "max_chars": 500}})
    assert r2.status_code == 200
    assert "部门：研发部；项目：人员经费" in r2.json()["markdown"]
    assert "===CHUNK===" in r2.json()["markdown"]

    assert client.get(f"/api/jobs/{job['id']}/pdf").headers["content-type"] == "application/pdf"
    assert client.get("/api/jobs/nope").status_code == 404
    bad = client.post("/api/jobs", files={"file": ("a.pdf", b"hello", "application/pdf")})
    assert bad.status_code == 400
    assert client.get("/").status_code == 200
