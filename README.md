# 📚 BookTracker

> Tu biblioteca personal inteligente. Organiza tus libros, genera resúmenes con IA, analiza personajes y crea podcasts automáticos de tus lecturas.

---

## 🌟 Bloque 1: Características y Configuración Inicial
*Este apartado es común para cualquier tipo de instalación.*

### ✨ ¿Qué puedes hacer con BookTracker?
*   **Biblioteca Organizada:** Sube tus libros (PDF/EPUB) o crea fichas de los que tienes en papel.
*   **Análisis Inteligente:** La IA lee tus libros por ti y genera resúmenes por capítulo y ensayos globales.
*   **Psicología de Personajes:** Descubre la personalidad y evolución de los protagonistas.
*   **Podcast Automático:** Convierte el análisis de tu libro en un audio para escucharlo donde quieras.

### 🔑 Configuración de las "Llaves" de IA
Para que BookTracker pueda "leer" y "pensar", necesita una llave de acceso a modelos de IA.
1.  Entra en la aplicación y **regístrate**.
2.  Haz clic en tu nombre o avatar **abajo a la izquierda (en la barra lateral)** → **Ajustes de IA**.
3.  Introduce una clave de **Google Gemini** o **Groq** (ambas tienen opciones gratuitas muy generosas).
4.  ¡Listo! Ya puedes subir tu primer libro.

### 📧 Configuración de Correo (Opcional pero recomendado)
Si quieres que la app te envíe correos (por ejemplo, para recuperar tu contraseña si se te olvida), necesitas configurar el servicio de mensajería:
*   **SMTP_HOST:** La dirección del servidor de tu correo (ej: `smtp.gmail.com`).
*   **SMTP_USER:** Tu dirección de correo (ej: `tu-usuario@gmail.com`).
*   **SMTP_PASS:** Tu contraseña (en Gmail se usa una "Contraseña de aplicación").
*   **SECRET_KEY:** Escribe una frase larga y rara aquí para proteger tu seguridad.

---

## ☁️ Bloque 2: Instalación en NAS / Servidor (Vía Portainer)
*Ideal para tener la app encendida 24/7 en tu servidor doméstico. **Sin usar terminales.***

1.  **Abre Portainer** en tu navegador.
2.  Ve a **Stacks** → **Add stack**.
3.  **Nombre:** Ponle `booktracker`.
4.  **Método:** Selecciona **Repository**.
5.  **Repository URL:** Pega la URL de este proyecto de GitHub.
6.  **Compose path:** Asegúrate de que ponga `docker-compose.yml`.
7.  **Variables de Entorno:** Baja hasta la sección "Environment variables" y pulsa "Add environment variable" para añadir las de correo explicadas arriba y el puerto:
    - `NGINX_PORT`: El número de puerto para entrar a la app (ej: `8081`).
8.  Pulsa el botón **Deploy the stack** y espera unos minutos. ¡Ya puedes entrar!

---

## 💻 Bloque 3: Instalación en Windows (PC Personal)
*La forma más rápida de probar la app en tu propio ordenador.*

### 1 — Preparar el terreno
1.  Descarga e instala **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**. Es el motor que hace que la app funcione.
2.  Sigue los pasos de instalación y, cuando termine, **reinicia tu PC**.
3.  Abre "Docker Desktop" y espera a que el icono de la ballena abajo a la izquierda esté en verde.

### 2 — Lanzar BookTracker
1.  Descarga este proyecto (botón verde "Code" → "Download ZIP") y descomprímelo en una carpeta.
2.  Busca el archivo llamado **`BOOKTRACKER.bat`** y haz doble clic sobre él.
3.  **No cierres la ventana negra** que se abrirá. Verás que después de unos segundos, **tu navegador se abrirá solo** en la dirección de la aplicación.

### 3 — ¿Cómo lo apago o lo enciendo otro día?
*   Para **apagarlo**: Solo tienes que cerrar la ventana negra o pulsar el botón "Stop" en Docker Desktop.
*   Para **encenderlo**: Solo vuelve a hacer doble clic en `BOOKTRACKER.bat`. No necesitas configurar nada más.

---
*Desarrollado con ❤️ para amantes de la lectura y la tecnología.*
