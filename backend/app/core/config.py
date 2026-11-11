from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    SECRET_KEY: str  # obligatoria, sin valor por defecto: si falta, la aplicación no arranca
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    # Rutas del sistema
    DATABASE_DIR: str = "/data/databases"
    UPLOADS_DIR: str = "/data/uploads"
    AUDIO_DIR: str = "/data/audio"
    COVERS_DIR: str = "/data/covers"

    REDIS_URL: str = "redis://localhost:6379/0"

    # URL pública de la aplicación (para los enlaces de los correos de verificación y recuperación)
    APP_URL: str = "http://localhost:3000"

    # Correo: servicio central (CENTRAL_EMAIL_*) o SMTP directo (SMTP_*); si no hay ninguno, los correos se escriben en el registro
    CENTRAL_EMAIL_URL: Optional[str] = None
    CENTRAL_EMAIL_KEY: Optional[str] = None
    SMTP_SECURE: Optional[str] = None
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
