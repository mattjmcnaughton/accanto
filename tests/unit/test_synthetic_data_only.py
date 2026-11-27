"""Tracked files hold only synthetic data: no exports, dumps, recordings or credentials.

The repository is public and its owner keeps real finances in Accanto. This is a
cheap backstop for the obvious mistakes; it cannot recognise a real amount or
payee, so the privacy rules in AGENTS.md still require reviewing provenance.
"""

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# Financial exports, database dumps, browser captures and recordings.
FORBIDDEN_SUFFIXES = {
    ".csv", ".tsv", ".ofx", ".qfx", ".qif", ".xls", ".xlsx", ".ods", ".pdf",
    ".sql", ".dump", ".db", ".sqlite", ".sqlite3", ".har",
    ".mp4", ".mov", ".webm", ".gif",
}  # fmt: skip
FORBIDDEN_NAMES = re.compile(r"accanto-prototype-.*\.json|accanto-recovery\.json")
# Screenshots are reviewed synthetic captures kept in one place. App icons are
# rendered from public/icons/icon.svg by scripts/render_icons.mjs, never captured.
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
IMAGE_DIRS = ("docs/screenshots/", "src/accanto/web/frontend/public/icons/")

EMAIL = re.compile(
    r"[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})"
)
SYNTHETIC_EMAIL_DOMAIN = re.compile(r"(^|\.)example(\.(test|com|org|net))?$")
# Project metadata names the author; that is not user or financial data.
AUTHOR_METADATA = {".copier-answers.yml", "pyproject.toml"}

CREDENTIAL = re.compile(
    r"sk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{20,}"  # OpenRouter, Anthropic, OpenAI
    r"|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"  # GitHub
    r"|AKIA[0-9A-Z]{16}"  # AWS
    r"|xox[abprs]-[A-Za-z0-9-]{10,}"  # Slack
    r"|pylf_v\d+_[A-Za-z0-9_]{10,}"  # Logfire
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}"  # JWT
)


def tracked_files() -> list[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
        ).stdout
    except (FileNotFoundError, subprocess.CalledProcessError):
        pytest.skip("not a Git checkout")
    return [
        path for path in out.decode().split("\0") if path and (ROOT / path).is_file()
    ]


def tracked_text() -> list[tuple[str, str]]:
    texts = []
    for path in tracked_files():
        data = (ROOT / path).read_bytes()
        if b"\0" not in data[:8192]:
            texts.append((path, data.decode("utf-8", errors="replace")))
    return texts


def test_no_exports_dumps_or_recordings_are_tracked():
    offending = [
        path
        for path in tracked_files()
        if (suffix := Path(path).suffix.lower()) in FORBIDDEN_SUFFIXES
        or FORBIDDEN_NAMES.fullmatch(Path(path).name)
        or (suffix in IMAGE_SUFFIXES and not path.startswith(IMAGE_DIRS))
    ]
    assert offending == [], (
        "Only synthetic data may be committed. Remove these files, or keep reviewed "
        "synthetic screenshots in docs/screenshots/: " + ", ".join(offending)
    )


def test_emails_are_synthetic():
    offending = [
        f"{path}: {match.group(0)}"
        for path, text in tracked_text()
        if path not in AUTHOR_METADATA
        for match in EMAIL.finditer(text)
        if not SYNTHETIC_EMAIL_DOMAIN.search(match.group(1).lower())
    ]
    assert offending == [], (
        "Use example.test addresses in code, tests and docs: " + ", ".join(offending)
    )


def test_no_credentials_are_tracked():
    offending = [
        f"{path}:{text.count(chr(10), 0, match.start()) + 1}"
        for path, text in tracked_text()
        for match in CREDENTIAL.finditer(text)
    ]
    assert offending == [], "Remove the credential and rotate it: " + ", ".join(
        offending
    )
