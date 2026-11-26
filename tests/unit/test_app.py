"""Check the application boundary shared by development and production."""

import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from accanto.app import create_app
from accanto.web import serve


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<h1>Accanto</h1>")
    monkeypatch.setattr(serve, "FRONTEND_DIST", tmp_path)
    with TestClient(create_app()) as client:
        yield client


def test_startup_does_not_import_the_agent_or_mcp_stack():
    # A deploy waits about 12 s for the port, and these imports take seconds of CPU
    # on the Box; the assistant and /mcp load them on their first request.
    # A fresh interpreter, because other tests import them into this one.
    heavy = ["pydantic_ai", "openai", "fastmcp", "mcp"]
    loaded = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys, accanto.app; "
            f"print(sorted(m for m in {heavy!r} if m in sys.modules))",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert loaded == "[]"


def test_liveness_is_available_with_frontend_mounted(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/", "/plan/review"])
def test_frontend_navigation_serves_the_app(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.text == "<h1>Accanto</h1>"


@pytest.mark.parametrize("path", ["/api/missing", "/assets/missing.js"])
def test_missing_api_and_assets_do_not_return_the_app(client, path):
    assert client.get(path).status_code == 404
