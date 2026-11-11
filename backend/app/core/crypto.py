"""Cifrado de las claves de IA de los usuarios (AES-256-GCM).

La clave de cifrado se deriva de SECRET_KEY. Lo guardado lleva el prefijo «enc:v1:»; un valor sin prefijo se
considera una clave antigua en claro (se lee tal cual y se cifra en el arranque, ver migrate_plaintext_keys).
Si SECRET_KEY cambia, las claves cifradas no se pueden leer y cada usuario deberá volver a introducirlas.
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.types import Text, TypeDecorator

from app.core.config import settings

PREFIX = "enc:v1:"


def _aes() -> AESGCM:
    return AESGCM(hashlib.sha256(f"booktracker-api-keys:{settings.SECRET_KEY}".encode()).digest())


def encrypt_secret(plain: str) -> str:
    nonce = os.urandom(12)
    return PREFIX + base64.b64encode(nonce + _aes().encrypt(nonce, plain.encode(), None)).decode()


def decrypt_secret(stored):
    """Devuelve la clave en claro; None si no se puede descifrar (SECRET_KEY distinta o dato dañado)."""
    if not stored:
        return stored
    if not stored.startswith(PREFIX):
        return stored  # valor antiguo en claro, pendiente de migrar
    try:
        raw = base64.b64decode(stored[len(PREFIX):])
        return _aes().decrypt(raw[:12], raw[12:], None).decode()
    except Exception:
        return None


class EncryptedText(TypeDecorator):
    """Columna de texto que se guarda cifrada y se lee ya descifrada."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if not value:
            return value
        return value if value.startswith(PREFIX) else encrypt_secret(value)

    def process_result_value(self, value, dialect):
        return decrypt_secret(value)


API_KEY_COLUMNS = ("gemini_api_key", "openai_api_key", "anthropic_api_key", "groq_api_key")


async def migrate_plaintext_keys(conn):
    """Cifra, una sola vez, las claves que aún estén en claro en la tabla de usuarios."""
    from sqlalchemy import text
    rows = (await conn.execute(text(f"SELECT id, {', '.join(API_KEY_COLUMNS)} FROM users"))).all()
    migrated = 0
    for row in rows:
        for col, value in zip(API_KEY_COLUMNS, row[1:]):
            if value and not value.startswith(PREFIX):
                await conn.execute(text(f"UPDATE users SET {col} = :v WHERE id = :id"), {"v": encrypt_secret(value), "id": row[0]})
                migrated += 1
    if migrated:
        print(f"[SEGURIDAD] {migrated} clave(s) de IA cifradas en la base de datos")
