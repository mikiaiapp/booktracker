# 📚 BookTracker
<!-- Test synchronización automática -->

> Sistema multiusuario para el seguimiento y análisis inteligente de libros con IA.
> Desplegable en **Synology NAS** mediante GitHub + Portainer.

![Stack](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square)
![Stack](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB?style=flat-square)
![Stack](https://img.shields.io/badge/IA-Gemini%20|%20Groq%20|%20Claude-4285F4?style=flat-square)
![Stack](https://img.shields.io/badge/Deploy-Docker%20%2B%20Portainer-2496ED?style=flat-square)

**🚀 [Guía rápida de despliegue →](QUICKSTART.md)**

---

## ✨ Características principales

### 📖 Gestión de biblioteca
- Sube PDFs y EPUBs para análisis automático o crea fichas manuales.
- Metadatos automáticos desde Open Library y Google Books con descarga de portadas.
- Estados de lectura, valoraciones y biblioteca organizada por autores.

### 🤖 Análisis con IA (Multimodal)
- **Análisis Multi-Proveedor:** Soporte para **Gemini (gratis)**, **Groq (gratis)**, **Claude (Anthropic)** y **OpenAI**.
- **Resúmenes Magistrales:** Análisis por capítulo y ensayo global literario.
- **Personajes y Mapas Mentales:** Extracción de psicología de personajes y visualización interactiva de conceptos.
- **Podcast:** Generación automática de guion y audio (TTS) para escuchar tus libros.

### 👥 Multiusuario y Privacidad
- Registro, login, 2FA y recuperación de contraseña.
- **Gestión de APIs en el perfil:** Cada usuario configura sus propias claves desde la web, sin tocar Docker.
- Bases de datos SQLite independientes por usuario para máxima privacidad.

---

## Despliegue en NAS con Portainer

### 1 — Preparar el NAS
Crea las carpetas de datos necesarias (vía SSH o File Station):
```bash
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
```

---

### 2 — Crear el Stack en Portainer
1. En **Portainer → Stacks → Add stack → Repository**.
2. **Name:** `booktracker`.
3. **Repository URL:** La URL de este repositorio.
4. **Compose path:** `docker-compose.yml`.

---

### 3 — Variables de Entorno (Environment variables)
Solo necesitas configurar las variables de sistema. Las claves de IA se configuran después en la aplicación.

#### Obligatorias (Sistema)
| Variable | Valor | Descripción |
|----------|-------|-------------|
| `SECRET_KEY` | Texto aleatorio largo | Para cifrar sesiones y seguridad interna. |
| `NGINX_PORT` | `8080` | Puerto donde estará disponible la app. |

#### Recomendadas (Email)
*Necesarias para recuperar contraseñas y 2FA.*
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

#### IA Local (Ollama - Opcional)
- `USE_OLLAMA_FOR_FAST_TASKS`: `true`
- `OLLAMA_URL`: `http://IP_DE_TU_NAS:11434`
- `OLLAMA_MODEL`: `llama3.1`.

---

### 4 — Configurar las APIs en la App
Una vez desplegado:
1. Accede a `http://IP-NAS:8080` y regístrate.
2. Ve a **Perfil → Configuración de IA**.
3. Introduce tus claves de **Gemini** (Gratis), **Groq** (Gratis) o **OpenAI/Anthropic**.

---

## 🤖 Uso de IA Local (Ollama)
Puedes instalar Ollama en tu NAS con este stack:
```yaml
version: "3"
services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
    ports: ["11434:11434"]
    volumes: ["/volume1/docker/ollama:/root/.ollama"]
    # devices: ["/dev/dri:/dev/dri"] # Aceleración Intel iGPU
```

---

## Actualizar a nuevas versiones
1. En Portainer, entra en el stack `booktracker`.
2. Pulsa en **Editor** y luego en **"Update the stack"**.
3. Marca **"Re-pull image and redeploy"** y pulsa **Update**.

---

## Arquitectura
- **Backend:** FastAPI + Celery para tareas pesadas.
- **Frontend:** React + Vite (PWA instalable).
- **Almacenamiento:** `/volume1/docker/booktracker/data/`.

---
*Desarrollado con ❤️ para amantes de la lectura y la tecnología.*
