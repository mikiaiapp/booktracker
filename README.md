# 📚 BookTracker

> Sistema multiusuario para el seguimiento y análisis inteligente de libros con IA.
> Desplegable en **Synology NAS** mediante GitHub + Portainer.

![Stack](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square)
![Stack](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB?style=flat-square)
![Stack](https://img.shields.io/badge/IA-Gemini%202.0%20Flash-4285F4?style=flat-square)
![Stack](https://img.shields.io/badge/Deploy-Docker%20%2B%20Portainer-2496ED?style=flat-square)

---

## Despliegue en Synology NAS con Portainer

### 1 — Preparar el NAS (una sola vez, vía SSH)

```bash
# Crear carpetas de datos
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
```

---

### 2 — Crear el Stack en Portainer

**Portainer → Stacks → Add stack → Repository**

| Campo | Valor |
|-------|-------|
| Name | `booktracker` |
| Repository URL | `https://github.com/TU_USUARIO/TU_REPO` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |

Si el repo es **privado**: activa *Authentication* → usuario GitHub + [Personal Access Token](https://github.com/settings/tokens) (scope: `repo`).

---

### 3 — Variables de entorno en Portainer

Sección **Environment variables** del Stack:

#### Obligatorias

| Variable | Valor |
|----------|-------|
| `SECRET_KEY` | Texto aleatorio largo (mín. 32 chars) |
| `GEMINI_API_KEY` | Clave de [aistudio.google.com](https://aistudio.google.com) → Get API key |
| `GOOGLE_API_KEY` | La misma clave (nombre que usa la librería de Google) |
| `AI_MODEL` | `gemini-2.0-flash` |

> ⚠️ **Importante:** La clave de Gemini debe crearse en **AI Studio** con
> **"Create API key in new project"** (proyecto sin billing activado).
> Así se activa la capa gratuita de 1.500 peticiones/día.
> Si la clave viene de Google Cloud Console con billing, el límite es 0.

#### Para el podcast TTS (opcional)

| Variable | Valor |
|----------|-------|
| `OPENAI_API_KEY` | `sk-...` de [platform.openai.com](https://platform.openai.com) |
| `TTS_PROVIDER` | `openai` |

#### Otras opcionales

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `NGINX_PORT` | `8080` | Puerto de acceso web |
| `ANTHROPIC_API_KEY` | — | Si prefieres Claude en vez de Gemini |
| `SMTP_HOST` | — | Para 2FA por email (ej: `smtp.gmail.com`) |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` | — | |
| `SMTP_PASS` | — | App Password de Google |

---

### 4 — Deploy

Clic en **Deploy the stack**. La primera vez tarda 5–15 minutos.

---

### 5 — Acceder

```
http://IP-NAS:8080
```

---

## Actualizar código

Cuando hagas cambios en el código:

```bash
# 1. Haz commit y push a GitHub
git add .
git commit -m "Nueva funcionalidad"
git push

# 2. En Portainer → Stacks → booktracker → "Pull and redeploy"
# Espera 2-3 minutos mientras reconstruye las imágenes
```

El stack completo se reconstruye automáticamente con el código actualizado.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│  NGINX  (puerto 8080)                               │
│   ├── /api/*    →  backend:8000   (FastAPI)         │
│   ├── /data/*   →  archivos estáticos               │
│   └── /*        →  frontend:3000  (React + Vite)    │
├─────────────────────────────────────────────────────┤
│  Celery worker  ←→  Redis                           │
│   · Fase 1 — Open Library + Google Books            │
│   · Fase 2 — estructura PDF/EPUB                    │
│   · Fase 3 — resúmenes IA (Gemini 2.0 Flash)        │
│   · Podcast — guión + TTS audio MP3                 │
├─────────────────────────────────────────────────────┤
│  SQLite por usuario                                 │
│   /data/databases/global.db       ← usuarios        │
│   /data/databases/user_{id}.db    ← libros          │
└─────────────────────────────────────────────────────┘
```

### Carpetas en el NAS

```
/volume1/docker/booktracker/
└── data/
    ├── uploads/      ← PDFs y EPUBs originales
    ├── covers/       ← portadas descargadas
    ├── audio/        ← podcasts MP3
    ├── databases/    ← SQLite (global.db + user_{id}.db)
    └── redis/        ← cola de tareas Celery
```

---

## Comandos útiles

```bash
# Ver estado de los contenedores
docker ps | grep booktracker

# Logs en tiempo real
docker logs booktracker-worker -f
docker logs booktracker-backend -f

# Reiniciar un servicio específico
docker restart booktracker-worker
docker restart booktracker-backend

# Backup de datos
tar -czf backup-$(date +%Y%m%d).tar.gz /volume1/docker/booktracker/data/

# Ver uso de recursos
docker stats booktracker-backend booktracker-worker
```

---

## Solución de errores frecuentes

| Error | Causa | Solución |
|-------|-------|----------|
| `Quota exceeded, limit: 0` | Clave Gemini con billing activado | Crear clave nueva en AI Studio con proyecto nuevo sin billing |
| `No API_KEY or ADC found` | `GOOGLE_API_KEY` no definida | Añadir en Portainer → Environment variables |
| `bcrypt` error al registrar | Versión incompatible de bcrypt | Verificar `bcrypt==4.0.1` en requirements.txt |
| Backend unhealthy | Arranque lento en NAS | Esperar 2-3 min y verificar logs con `docker logs booktracker-backend` |
| Worker no procesa tareas | Redis desconectado | Verificar `docker logs booktracker-redis` y reiniciar stack |
| Imágenes no se muestran | Permisos en /data/covers | `chmod -R 755 /volume1/docker/booktracker/data/covers` |

---

## Coste estimado

| Proveedor | Modelo | Coste por libro |
|-----------|--------|-----------------|
| Google Gemini | gemini-2.0-flash | **Gratuito** (1.500 req/día) |
| Anthropic | claude-sonnet-4 | €0.30–0.85 |
| OpenAI | gpt-4o | €0.40–1.00 |
| Audio TTS | openai tts-1 | €0.12 por podcast |
