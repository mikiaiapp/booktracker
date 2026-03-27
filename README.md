# 📚 BookTracker

> Sistema multiusuario para el seguimiento y análisis inteligente de libros con IA.  
> Desplegable en **Synology NAS** mediante GitHub + Portainer.

![Stack](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square)
![Stack](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB?style=flat-square)
![Stack](https://img.shields.io/badge/IA-Claude%20%2F%20GPT--4o-7C3AED?style=flat-square)
![Stack](https://img.shields.io/badge/Deploy-Docker%20%2B%20Portainer-2496ED?style=flat-square)

---

## ¿Qué hace BookTracker?

Sube un libro en PDF o EPUB y la aplicación realiza automáticamente tres fases de análisis:

| Fase | Descripción |
|------|-------------|
| **① Identificación** | Obtiene portada, ISBN, sinopsis, biografía del autor y bibliografía desde Open Library, Google Books y Wikipedia |
| **② Estructura** | Detecta partes y capítulos del libro (PDF por TOC o heurísticas, EPUB por estructura nativa) |
| **③ Análisis IA** | Resume cada capítulo con spoilers completos, analiza personajes, genera resumen global, mapa mental interactivo y podcast de audio a dos voces |

---

## Requisitos previos

- Synology NAS con **DSM 7.x**
- **Container Manager** instalado (Centro de Paquetes)
- **Portainer** instalado como contenedor
- Al menos una API key: [Anthropic](https://console.anthropic.com) o [OpenAI](https://platform.openai.com)
- Acceso SSH al NAS

---

## Despliegue paso a paso

### 1 — Preparar carpetas en el NAS

Conéctate al NAS por SSH y ejecuta:

```bash
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
```

> Ajusta `/volume1` si tu volumen principal es diferente (compruébalo en DSM → Storage Manager).

---

### 2 — Subir este repositorio a GitHub

Si aún no lo has hecho, desde tu PC:

```bash
# Descomprime el ZIP del proyecto y entra en la carpeta
cd booktracker

# Inicializa y sube a GitHub
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

> ⚠️ **Nunca subas el archivo `.env`** al repositorio. Está excluido por `.gitignore`. Las credenciales se configuran directamente en Portainer.

---

### 3 — Crear el Stack en Portainer

En Portainer: **Stacks → Add stack → Repository**

| Campo | Valor |
|-------|-------|
| Name | `booktracker` |
| Repository URL | `https://github.com/TU_USUARIO/TU_REPO` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |

Si el repositorio es **privado**, activa la opción **Authentication** e introduce:
- Username: tu usuario de GitHub
- Password: un [Personal Access Token](https://github.com/settings/tokens) con scope `repo`

---

### 4 — Variables de entorno en Portainer

En la misma pantalla del Stack, sección **Environment variables**, añade las siguientes:

#### Obligatorias

| Variable | Valor |
|----------|-------|
| `SECRET_KEY` | Texto aleatorio largo (mínimo 32 caracteres) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` — obtener en [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | `sk-...` — obtener en [platform.openai.com](https://platform.openai.com) |
| `AI_MODEL` | `claude-sonnet-4-20250514` o `gpt-4o` |
| `TTS_PROVIDER` | `openai` (recomendado, más barato) o `elevenlabs` |

> Puedes omitir `ANTHROPIC_API_KEY` si solo usas OpenAI, y viceversa.  
> Para el podcast de audio se necesita `OPENAI_API_KEY` (modelo `tts-1`).

#### Opcionales

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `NGINX_PORT` | `8080` | Cambia si el puerto está ocupado |
| `ELEVENLABS_API_KEY` | — | Solo si `TTS_PROVIDER=elevenlabs` |
| `SMTP_HOST` | — | Servidor SMTP para 2FA por email (ej: `smtp.gmail.com`) |
| `SMTP_PORT` | `587` | Puerto SMTP |
| `SMTP_USER` | — | Cuenta de correo |
| `SMTP_PASS` | — | Contraseña de aplicación de Google |
| `SMTP_FROM` | `noreply@booktracker.local` | Remitente del email OTP |

> **Gmail:** activa la verificación en 2 pasos y genera una [App Password](https://myaccount.google.com/apppasswords) en lugar de usar tu contraseña habitual.

---

### 5 — Deploy

Haz clic en **Deploy the stack**.

La primera vez tarda **5–15 minutos** porque Docker descarga las imágenes base y compila el frontend de React. Puedes ver el progreso en **Containers → booktracker-backend → Logs**.

Una vez desplegado, los 5 contenedores deben aparecer en estado **running**:

```
booktracker-nginx      ✓ running
booktracker-frontend   ✓ running
booktracker-backend    ✓ running
booktracker-worker     ✓ running
booktracker-redis      ✓ running
```

---

### 6 — Acceder a la aplicación

Abre el navegador en tu PC:

```
http://IP-NAS:8080
```

Sustituye `IP-NAS` por la dirección IP local de tu Synology (por ejemplo `192.168.1.100`).

---

## Primer uso

1. Haz clic en **Crear cuenta**
2. Introduce email, usuario y contraseña
3. Elige el método de doble factor de autenticación:
   - **App autenticadora (TOTP)** — escanea el QR con Google Authenticator, Authy o similar
   - **Código por email** — recibirás un OTP en cada acceso (requiere SMTP configurado)
4. Inicia sesión e introduce el código de 6 dígitos
5. En **Añadir libro**, arrastra un PDF o EPUB y espera a que las fases se completen

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
│   · Fase 1 — Open Library + Google Books + Wikipedia│
│   · Fase 2 — estructura PDF (TOC/heurísticas) / EPUB│
│   · Fase 3 — resúmenes IA, personajes, mapa mental  │
│   · Podcast — guión a 2 voces + TTS audio MP3       │
├─────────────────────────────────────────────────────┤
│  SQLite por usuario (aislamiento total de datos)    │
│   /data/databases/global.db       ← usuarios        │
│   /data/databases/user_{id}.db    ← libros          │
└─────────────────────────────────────────────────────┘
```

Todos los datos (bases de datos, PDFs, portadas, audios) se almacenan en:

```
/volume1/docker/booktracker/data/
├── uploads/      ← PDFs y EPUBs originales
├── covers/       ← portadas descargadas
├── audio/        ← podcasts MP3 generados
├── databases/    ← SQLite global + por usuario
└── redis/        ← persistencia de la cola de tareas
```

---

## Actualizar a una nueva versión

```bash
# 1. Actualiza el repositorio en tu PC y sube los cambios
git add .
git commit -m "update"
git push

# 2. En Portainer: Stacks → booktracker → Pull and redeploy
```

---

## Comandos útiles (SSH en el NAS)

```bash
# Ver estado de los contenedores
docker compose -p booktracker ps

# Ver logs en tiempo real
docker compose -p booktracker logs -f
docker compose -p booktracker logs -f worker     # solo el worker IA
docker compose -p booktracker logs -f backend    # solo el backend

# Reiniciar un servicio concreto
docker compose -p booktracker restart worker

# Parar todos los servicios
docker compose -p booktracker down

# Backup completo de datos
tar -czf backup-$(date +%Y%m%d).tar.gz /volume1/docker/booktracker/data/
```

---

## Solución de problemas frecuentes

| Error | Causa probable | Solución |
|-------|---------------|----------|
| `npm ci` falla en el build | No hay `package-lock.json` | El Dockerfile usa `npm install`, asegúrate de tener la versión actualizada |
| `backend is unhealthy` | El backend tarda en arrancar | Los healthchecks tienen `start_period: 60s`, espera y reintenta el deploy |
| La web no carga | Algún contenedor caído | `docker compose -p booktracker ps` y revisa los logs del contenedor en rojo |
| Error de API key | Key mal copiada | Verifica en Portainer → Stack → Editor que no haya espacios o saltos de línea |
| El worker no procesa | Redis no responde | `docker compose -p booktracker restart redis worker` |
| Puerto 8080 ocupado | Conflicto con otro servicio | Cambia `NGINX_PORT` a `8081` o `8090` en las variables de Portainer |

---

## Coste estimado por libro analizado

| Operación | Modelo | Coste aprox. |
|-----------|--------|-------------|
| Resúmenes de capítulos (20 caps) | Claude Sonnet / GPT-4o | €0.10 – 0.40 |
| Análisis de personajes | Claude Sonnet / GPT-4o | €0.05 – 0.15 |
| Resumen global + mapa mental | Claude Sonnet / GPT-4o | €0.05 – 0.10 |
| Guión del podcast | Claude Sonnet / GPT-4o | €0.02 – 0.08 |
| Audio TTS (~8.000 caracteres) | OpenAI `tts-1` | €0.12 |
| **Total por libro** | | **€0.30 – 0.85** |

---

## Seguridad

- Las contraseñas se hashean con **bcrypt**
- Los tokens JWT expiran en **24 horas**
- Los tokens temporales de 2FA expiran en **10 minutos**
- Cada usuario tiene su propia base de datos SQLite: **aislamiento total**
- Ningún endpoint expone datos de otros usuarios
- Las credenciales nunca se almacenan en el repositorio

---

## Licencia

MIT
