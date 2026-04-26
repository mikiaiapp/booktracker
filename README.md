# 📚 BookTracker

> Tu biblioteca personal inteligente. Organiza tus libros, genera resúmenes con IA, analiza personajes, crea podcasts y **charla directamente con tus lecturas**.

---

## 🌟 Bloque 1: Características y Configuración Inicial
*Este apartado es común para cualquier tipo de instalación.*

### ✨ ¿Qué puedes hacer con BookTracker?
*   **Biblioteca Organizada:** Sube tus libros (PDF/EPUB) para analizarlos y resumirlos.
*   **Análisis Inteligente:** La IA lee tus libros por ti y genera resúmenes por capítulo y ensayos globales.
*   **Psicología de Personajes:** Descubre la personalidad y evolución de los protagonistas.
*   **Podcast Automático:** Convierte el análisis de tu libro en un audio para escucharlo donde quieras.
*   **Charla con tus Libros:** Haz preguntas directamente a tus libros para resolver dudas o profundizar en la trama.

### 🔑 Configuración de las "Llaves" de IA
Para que BookTracker pueda "leer" y "pensar", necesita una llave de acceso a modelos de IA.
1.  Entra en la aplicación y **regístrate**.
2.  Haz clic en tu nombre o avatar **abajo a la izquierda (en la barra lateral)** → **Ajustes de IA**.
3.  Introduce una clave de **Google Gemini** o **Groq** (ambas tienen opciones gratuitas muy generosas).
4.  ¡Listo! Ya puedes subir tu primer libro.


---

## ☁️ Bloque 2: Instalación en NAS / Servidor (Vía Portainer)
*Ideal para tener la app encendida 24/7 en tu servidor doméstico. **Sin usar terminales.***

1.  **Abre Portainer** en tu navegador.
2.  Ve a **Stacks** → **Add stack**.
3.  **Nombre:** Ponle `booktracker`.
4.  **Método:** Selecciona **Repository**.
5.  **Repository URL:** Pega la URL de este proyecto de GitHub.
6.  **Compose path:** Asegúrate de que ponga `docker-compose.yml`.
7.  **Variables de Entorno:** Baja hasta la sección "Environment variables" y pulsa **"Add environment variable"** para añadir estas configuraciones clave:
    *   `NGINX_PORT`: El número de puerto para entrar a la app (ej: `8081`).
    *   `SECRET_KEY`: Una frase larga y rara de al menos 32 caracteres (no tienes que memorizarla).
    *   `SMTP_HOST`: El servidor de tu correo (ej: `smtp.gmail.com`).
    *   `SMTP_USER`: Tu dirección de correo (ej: `tu-usuario@gmail.com`).
    *   `SMTP_PASS`: Tu contraseña de correo (en Gmail usa una [Contraseña de Aplicación](https://myaccount.google.com/apppasswords)).
8.  Pulsa el botón **Deploy the stack** y espera unos minutos. ¡Ya puedes entrar!

---

## 💻 Bloque 3: Instalación en Windows (PC Personal)
*La forma más rápida de probar la app en tu propio ordenador.*

### 1 — Preparar el terreno
1.  Descarga e instala **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**. Es el motor que hace que la app funcione.
2.  Sigue los pasos de instalación y, cuando termine, **reinicia tu PC**.
3.  Abre "Docker Desktop" y espera a que el icono de la ballena abajo a la izquierda esté en verde.

### 2 — Descargar el proyecto
1.  Pulsa arriba en el botón verde que dice **"Code"** y elige **"Download ZIP"**.
2.  Descomprime ese archivo en una carpeta de tu ordenador (por ejemplo, en el Escritorio o en Documentos).

### 3 — Lanzar BookTracker
1.  Abre la carpeta que acabas de descomprimir.
2.  Busca el archivo llamado **`BOOKTRACKER.bat`** y haz doble clic sobre él.
3.  **No cierres la ventana negra** que se abrirá. Verás que después de unos segundos, **tu navegador se abrirá solo** en la dirección de la aplicación.

### 4 — ¿Cómo lo apago o lo enciendo otro día?
*   Para **apagarlo**: Solo tienes que cerrar la ventana negra o pulsar el botón "Stop" en Docker Desktop.
*   Para **encenderlo**: Solo vuelve a hacer doble clic en `BOOKTRACKER.bat`. No necesitas configurar nada más.

### 4 — Configuración avanzada (Correo)
Si en el futuro quieres que la app de Windows también envíe correos (como en el NAS), busca el archivo llamado **`.env.example`**, cámbiale el nombre a **`.env`**, ábrelo con el Bloc de Notas y rellena los datos siguiendo las instrucciones que verás dentro.

---
*Desarrollado con ❤️ para amantes de la lectura y la tecnología.*
<!-- Last Sync: 2026-04-26 11:17:00 -->
