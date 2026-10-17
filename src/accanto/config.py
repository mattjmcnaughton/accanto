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

    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/accanto"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
