from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+psycopg://spareline:spareline@localhost:5544/spareline"
    allowed_origins: str = "http://localhost:3000"
    allowed_origin_regex: str | None = None
    session_signing_key: str = "dev-only-not-secret"
    public_base_url: str = "http://localhost:8000"
    data_dir: str = "../../data/processed"
    max_scenario_stops: int = 400
    solver_job_timeout_seconds: int = 60
    solver_workers: int = 2
    rate_limit_per_minute: int = 120
    run_rate_limit_per_minute: int = 12

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


SERVICE_NAME = "spareline-api"
SERVICE_VERSION = "1.0.0"
