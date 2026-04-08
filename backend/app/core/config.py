from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    # IA — configura solo el que vayas a usar
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    AI_MODEL: str = "gemini-2.0-flash"   # por defecto gratuito
    TTS_PROVIDER: str = "openai"

    # Ollama — IA Local
    OLLAMA_URL: str = "http://ollama:11434"
    OLLAMA_MODEL: str = "llama3"
    USE_OLLAMA_FOR_FAST_TASKS: str = "false" # "true" o "false"

    DATABASE_DIR: str = "/data/databases"
    UPLOADS_DIR: str = "/data/uploads"
    AUDIO_DIR: str = "/data/audio"
    COVERS_DIR: str = "/data/covers"

    REDIS_URL: str = "redis://localhost:6379/0"

    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASS: Optional[str] = None
    SMTP_FROM: str = "noreply@booktracker.local"

    GLOBAL_DB_PATH: str = ""

    def model_post_init(self, __context):
        if not self.GLOBAL_DB_PATH:
            self.GLOBAL_DB_PATH = f"{self.DATABASE_DIR}/global.db"

    class Config:
        env_file = ".env"


settings = Settings()
