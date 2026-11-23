"""Shared test configuration."""

from pydantic_ai import models

# No test may reach a real model provider; live evals opt in explicitly
# (tests/external, marked external) and re-enable requests themselves.
models.ALLOW_MODEL_REQUESTS = False
