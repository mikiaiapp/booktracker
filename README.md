# 📚 BookTracker

Sistema multiusuario para el seguimiento y análisis inteligente de libros con IA.  
Desplegable en **Synology NAS** mediante GitHub + Portainer.

---

## Estructura del repositorio

```
booktracker/
├── docker-compose.yml        ← Portainer apunta aquí
├── .env.example              ← Referencia de variables (NO subas .env)
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── core/             ← config, database, security
│       ├── models/           ← user.py, book.py
│       ├── api/              ← auth, books, analysis, users
│       ├── services/         ← book_identifier, book_parser, ai_analyzer, tts_service
│       └── workers/          ← celery_app, tasks
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── index.css
│       ├── pages/            ← Login, Register, Library, Upload, Book
│       ├── components/       ← Layout, MindMap
│       ├── store/            ← authStore (Zustand)
│       └── utils/            ← api.js (Axios)
├── nginx/
│   └── nginx.conf
└── data/                     ← Vacía en el repo; se llena en el NAS
    ├── uploads/
    ├── covers/
    ├── audio/
    ├── databases/
    └── redis/
```

---

## Despliegue en Synology NAS con Portainer

### 1. Preparar el NAS (una sola vez vía SSH)

```bash
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
```

### 2. Crear Stack en Portainer

**Portainer → Stacks → Add stack → Repository**

| Campo | Valor |
|---|---|
| Name | `booktracker` |
| Repository URL | `https://github.com/TU_USUARIO/TU_REPO` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |

Si el repositorio es **privado**, activa *Authentication* e introduce tu usuario de GitHub y un Personal Access Token (GitHub → Settings → Developer settings → Personal access tokens).

### 3. Variables de entorno en Portainer

En la sección **Environment variables** del Stack añade:

**Obligatorias:**

| Variable | Valor |
|---|---|
| `SECRET_KEY` | Texto aleatorio largo (mín. 32 chars) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` si usas Claude |
| `OPENAI_API_KEY` | `sk-...` si usas GPT-4o o TTS |
| `AI_MODEL` | `claude-sonnet-4-20250514` o `gpt-4o` |
| `TTS_PROVIDER` | `openai` (recomendado) o `elevenlabs` |

**Opcionales:**

| Variable | Valor por defecto |
|---|---|
| `NGINX_PORT` | `8080` |
| `ELEVENLABS_API_KEY` | — |
| `SMTP_HOST` | — (para 2FA por email) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | — |
| `SMTP_PASS` | — |
| `SMTP_FROM` | `noreply@booktracker.local` |

### 4. Deploy

Clic en **Deploy the stack**. La primera vez tarda 5-15 minutos (compila el frontend y descarga imágenes base).

### 5. Acceso

```
http://IP-NAS:8080
```

---

## Arquitectura

```
┌─────────────────────────────────────────────┐
│  NGINX :8080                                │
│   ├── /api/*  → backend:8000  (FastAPI)     │
│   ├── /data/* → estáticos (covers, audio)   │
│   └── /*      → frontend:3000 (React)       │
├─────────────────────────────────────────────┤
│  Celery worker  ←→  Redis                   │
│   · Fase 1: metadatos web (Open Library,    │
│             Google Books, Wikipedia)        │
│   · Fase 2: estructura PDF/EPUB             │
│   · Fase 3: resúmenes IA por capítulo,      │
│             personajes, mapa mental         │
│   · Podcast: guión + TTS audio MP3          │
├─────────────────────────────────────────────┤
│  SQLite por usuario                         │
│   /data/databases/global.db      (usuarios) │
│   /data/databases/user_{id}.db   (libros)   │
└─────────────────────────────────────────────┘
```

---

## Comandos útiles

```bash
# Ver estado de los contenedores
docker compose ps

# Ver logs en tiempo real
docker compose logs -f
docker compose logs -f worker    # solo el worker IA

# Reiniciar un servicio
docker compose restart worker

# Parar todo
docker compose down

# Backup de datos
tar -czf backup-$(date +%Y%m%d).tar.gz /volume1/docker/booktracker/data/
```

---

## Autenticación 2FA

Soporta dos métodos seleccionables al registrarse:
- **TOTP** — Google Authenticator, Authy o cualquier app compatible. Se muestra QR al registrarse.
- **Email OTP** — Código de 6 dígitos por correo. Requiere configurar las variables `SMTP_*`.

Cada usuario tiene su propia base de datos SQLite aislada.

---

## Coste estimado por libro analizado

| Operación | Modelo | Aprox. |
|---|---|---|
| Resúmenes de capítulos | Claude Sonnet / GPT-4o | €0.10–0.40 |
| Análisis de personajes | Claude Sonnet / GPT-4o | €0.05–0.15 |
| Resumen global + mapa mental | Claude Sonnet / GPT-4o | €0.05–0.10 |
| Guión podcast | Claude Sonnet / GPT-4o | €0.02–0.08 |
| Audio TTS (~8.000 chars) | OpenAI tts-1 | €0.12 |
| **Total por libro** | | **€0.30–0.85** |
