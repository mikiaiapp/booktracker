# 📚 BookTracker

> Sistema multiusuario para el seguimiento y análisis inteligente de libros con IA.
> Desplegable en **Synology NAS** mediante GitHub + Portainer o en **Windows Local**.

![Stack](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square)
![Stack](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB?style=flat-square)
![Stack](https://img.shields.io/badge/IA-Gemini%20|%20Groq%20|%20OpenAI-4285F4?style=flat-square)
![Stack](https://img.shields.io/badge/Deploy-Docker%20%2B%20Portainer-2496ED?style=flat-square)

**🚀 [Guía rápida de despliegue →](QUICKSTART.md)**

---

## ✨ Características principales

### 📖 Gestión de biblioteca
- Sube PDFs y EPUBs para análisis automático o crea fichas manuales.
- Metadatos automáticos desde Open Library y Google Books con descarga de portadas.
- Estados de lectura, valoraciones y biblioteca organizada por autores.

### 🤖 Análisis con IA (Multimodal)
- **Análisis Multi-Proveedor:** Soporte para **Gemini (gratis)**, **Groq (gratis)** y **OpenAI**.
- **Resúmenes Magistrales:** Análisis por capítulo y ensayo global literario.
- **Personajes y Mapas Mentales:** Extracción de psicología de personajes y visualización interactiva de conceptos.
- **Podcast:** Generación automática de guion y audio (TTS) para escuchar tus libros.

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

### 3 — Variables de Entorno (Environment Variables)
Configura estas variables en la pestaña **Environment variables** de Portainer:
- `SECRET_KEY`: Una cadena aleatoria larga para proteger las sesiones.
- `NGINX_PORT`: El puerto donde quieras que responda la app (ej: `8080`).
- `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`: (Opcional) Si quieres activar la recuperación de contraseña por email y el 2FA.

---

## 🏁 Primeros Pasos (Configuración de IA)

Una vez instalada la aplicación (ya sea en NAS o Windows), sigue estos pasos para activar la inteligencia artificial:

1.  **Registro:** Accede a la URL de tu app y crea una cuenta de usuario.
2.  **Ajustes de IA:** Haz clic en tu avatar arriba a la derecha → **Perfil** → **Ajustes de IA**.
3.  **Añadir Claves:** Introduce tu clave de **Google Gemini** (Gratis) o **Groq** (Gratis).
4.  **Guardar y Probar:** Pulsa el botón "Probar" para verificar que la conexión funciona y guarda los cambios.

*¡A partir de este momento ya puedes subir tu primer libro!*

---

## 💻 Instalación Local en Windows (Fácil)

Si no quieres usar el servidor NAS, puedes ejecutar BookTracker directamente en tu PC.

### 1 — Instalar Docker Desktop (Modo Gráfico)
1. Descarga el instalador desde [Docker Desktop para Windows](https://www.docker.com/products/docker-desktop/).
2. Haz doble clic en el instalador y sigue los pasos (asegúrate de que la opción **"WSL 2"** esté activada).
3. **Reinicia tu PC** cuando termine.
4. Abre "Docker Desktop" desde el menú Inicio y espera a que el icono de la ballena se quede quieto (verde).

### 2 — Lanzar la Experiencia Completa
1. Descarga o clona este proyecto en una carpeta de tu PC.
2. Busca el archivo **`BOOKTRACKER.bat`** y haz doble clic sobre él.
3. **¡Listo!** El script configurará los contenedores y **abrirá automáticamente tu navegador** en [http://localhost:8081](http://localhost:8081).

---

## 🛠️ Gestión y Mantenimiento

*   **Gestión Visual:** Puedes abrir **Docker Desktop** y verás la lista `booktracker-local`. Desde ahí puedes ver logs, detener o reiniciar la app con botones de "Play/Stop".
*   **Actualizar:** Para bajar nuevas mejoras, haz un `git pull` de la carpeta y vuelve a ejecutar el `.bat`.

---

## Actualizar a nuevas versiones
- **En NAS:** Ve al Stack → Editor → "Update the stack" (marcando "Re-pull image").
- **En Windows:** Haz un `git pull` de la carpeta y vuelve a ejecutar `BOOKTRACKER.bat`.

---

## Arquitectura
- **Backend:** FastAPI + Celery para tareas pesadas.
- **Frontend:** React + Vite (PWA instalable).
- **Almacenamiento:** `/volume1/docker/booktracker/data/` (NAS) o `./data/` (Local).

---
*Desarrollado con ❤️ para amantes de la lectura y la tecnología.*
