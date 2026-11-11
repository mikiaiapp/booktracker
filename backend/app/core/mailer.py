"""Envío de correo de BookTracker.

Orden: servicio de correo central (CENTRAL_EMAIL_URL + CENTRAL_EMAIL_KEY) -> SMTP directo (SMTP_HOST...) -> modo de prueba
(el mensaje se escribe en el registro del contenedor, sin enviarse). Mismas variables que ContaMiki.
"""
import httpx
import aiosmtplib
from email.message import EmailMessage

from app.core.config import settings

_FROM_POR_DEFECTO = "noreply@booktracker.local"


async def send_email(to: str, subject: str, text: str, html: str = None, from_name: str = "BookTracker") -> bool:
    """Devuelve True si el correo salió (o se escribió en el registro en modo de prueba) y False si falló."""
    # 1) Servicio central
    if settings.CENTRAL_EMAIL_URL and settings.CENTRAL_EMAIL_KEY:
        url = settings.CENTRAL_EMAIL_URL.strip()
        if not url.startswith("http"):
            url = f"https://{url}"
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    url.rstrip("/") + "/send",
                    json={"to": to, "subject": subject, "text": text, "html": html or text,
                          "key": settings.CENTRAL_EMAIL_KEY, "fromName": from_name},
                )
            if r.status_code == 200 and r.json().get("success"):
                print(f"[CENTRAL EMAIL] Enviado a {to}")
                return True
            print(f"[CENTRAL EMAIL ERROR] HTTP {r.status_code}: {r.text[:200]}")
            return False
        except Exception as e:
            print(f"[CENTRAL EMAIL ERROR] {type(e).__name__}: {e}")
            return False

    # 2) SMTP directo
    if settings.SMTP_HOST:
        secure_env = (settings.SMTP_SECURE or "").strip().lower()
        secure = (secure_env == "true") if secure_env else settings.SMTP_PORT == 465
        remitente = settings.SMTP_FROM
        if remitente == _FROM_POR_DEFECTO and settings.SMTP_USER:
            remitente = settings.SMTP_USER
        msg = EmailMessage()
        msg["From"] = f'"{from_name}" <{remitente}>'
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(text)
        if html:
            msg.add_alternative(html, subtype="html")
        try:
            await aiosmtplib.send(
                msg,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                # solo se autentica si hay usuario y contraseña (un relé interno puede no pedirlos)
                username=settings.SMTP_USER if (settings.SMTP_USER and settings.SMTP_PASS) else None,
                password=settings.SMTP_PASS if (settings.SMTP_USER and settings.SMTP_PASS) else None,
                use_tls=secure,
                start_tls=None if not secure else False,
            )
            print(f"[SMTP] Enviado a {to}")
            return True
        except Exception as e:
            print(f"[SMTP ERROR] {type(e).__name__}: {e} (host {settings.SMTP_HOST}:{settings.SMTP_PORT})")
            return False

    # 3) Modo de prueba: nunca se devuelve el contenido por la API
    print("==================================================")
    print(f"[MOCK EMAIL] To: {to}")
    print(f"Subject: {subject}")
    print(f"Content: {text}")
    print("==================================================")
    return True
