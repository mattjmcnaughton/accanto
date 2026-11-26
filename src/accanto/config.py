"""Application configuration via environment variables."""

from pydantic import SecretStr
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    log_level: str = "INFO"
    log_format: str = "json"
    host: str = "0.0.0.0"
    port: int = 8000

    browser_origin: str = ""
    browser_csrf_secret: SecretStr = SecretStr("")
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: SecretStr = SecretStr("")
    oidc_allowed_emails: list[str] = []

    mcp_resource_url: str = ""
    mcp_issuer: str = ""
    mcp_jwks_uri: str = ""
    mcp_introspection_url: str = ""
    mcp_introspection_client_id: str = ""
    mcp_introspection_client_secret: SecretStr = SecretStr("")
    mcp_allowed_emails: list[str] = []

    # Fernet key that encrypts Transaction source tokens at rest (decision T1).
    # Generate with `uv run python -c "from cryptography.fernet import Fernet;
    # print(Fernet.generate_key().decode())"`. Without it, sources cannot connect.
    source_secret_key: SecretStr = SecretStr("")
    ynab_api_url: str = "https://api.ynab.com/v1"

    # Logfire write token for performance traces (accanto.telemetry). Unset means
    # nothing is exported. See docs/technical/telemetry.md.
    logfire_token: SecretStr = SecretStr("")
    logfire_environment: str = "development"
    logfire_base_url: str = "https://logfire-us.pydantic.dev"

    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/accanto"

    # Built-in agent (TDD 03). AGENT_MODEL is an OpenRouter model id, or "stub"
    # for the deterministic test model (refused for a public HTTPS origin).
    # Local development: OPENROUTER_API_KEY=$(cat ~/.config/accanto/...key).
    openrouter_api_key: SecretStr = SecretStr("")
    agent_model: str = ""
    agent_daily_message_cap: int = 200
    agent_reply_timeout: float = 90
    agent_concurrent_replies: int = 2
    agent_heartbeat_seconds: float = 15
    agent_history_turns: int = 10
    agent_retention_days: int = 30

    # Background jobs (TDD 11). The reconciler claims a queued job run every
    # interval; a running step whose lease is older than job_stale_after is
    # claimed again. A step must finish well inside its lease.
    job_reconciler_interval: float = 5
    job_concurrent_steps: int = 1
    job_step_timeout: float = 240
    job_stale_after: float = 600
    # Each step of `python -m accanto.jobs.tick` has its own deadline.
    job_tick_step_timeout: float = 300

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
