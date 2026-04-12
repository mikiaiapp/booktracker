# 📚 BookTracker

> Sistema multiusuario para el seguimiento y análisis inteligente de libros con IA.
> Desplegable en **Synology NAS** mediante GitHub + Portainer o en **Windows Local**.

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

## ☁️ Despliegue en NAS con Portainer

### 1 — Preparar el NAS
Crea las carpetas de datos necesarias (vía SSH o File Station):
```bash
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
```

### 2 — Crear el Stack en Portainer
1. En **Portainer → Stacks → Add stack → Repository**.
2. **Name:** `booktracker`.
3. **Repository URL:** La URL de este repositorio.
4. **Compose path:** `docker-compose.yml`.

### 3 — Variables de Entorno
Configura `SECRET_KEY` (clave aleatoria) y `NGINX_PORT` (`8080`). Las claves de IA se configuran después en la aplicación (Ajustes).

---

## 💻 Instalación Local en Windows (Independiente)

Puedes tener una copia de BookTracker en tu PC personal para pruebas sin afectar a la instalación del servidor NAS.

### 1 — Instalación de Docker Desktop
1. Descarga el instalador desde [Docker Desktop para Windows](https://www.docker.com/products/docker-desktop/).
2. Ejecuta el instalador. Asegúrate de que la opción **"Use WSL 2 instead of Hyper-V"** esté marcada.
3. Reinicia tu PC si se solicita.
4. Abre Docker Desktop y acepta los términos.

### 2 — Lanzar la aplicación
1. Abre una terminal (PowerShell o CMD) en la carpeta del proyecto.
2. Ejecuta:
   ```powershell
   docker-compose -f docker-compose.local.yml up -d
   ```

### 3 — Acceso
Accede desde tu navegador a: [http://localhost:8081](http://localhost:8081).
*Nota: Esta versión local usa el puerto 8081 y guarda sus propios datos en la carpeta `data/` del proyecto.*

---

## 🤖 Uso de IA Local (Ollama)
Puedes delegar tareas a un servidor **Ollama** local configurando estas variables en el Stack:
- `USE_OLLAMA_FOR_FAST_TASKS`: `true`
- `OLLAMA_URL`: `http://IP_DE_TU_NAS:11434`
- `OLLAMA_MODEL`: `llama3.1`

---

## Actualizar a nuevas versiones
1. En Portainer (NAS), entra en el stack y pulsa en **Editor** → **"Update the stack"**.
2. Marca **"Re-pull image and redeploy"** y pulsa **Update**.
3. En Windows, haz `git pull` y vuelve a ejecutar el comando de lanzamiento.

---

## Arquitectura
- **Backend:** FastAPI + Celery para tareas pesadas.
- **Frontend:** React + Vite (PWA instalable).
- **Almacenamiento:** `/volume1/docker/booktracker/data/` (NAS) o `./data/` (Local).

---
*Desarrollado con ❤️ para amantes de la lectura y la tecnología.*
