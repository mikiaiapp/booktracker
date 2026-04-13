from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    # Rutas del sistema
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
