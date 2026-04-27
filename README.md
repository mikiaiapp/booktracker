# 📚 BookTracker

> Tu biblioteca personal inteligente. Organiza tus libros, genera resúmenes con IA, analiza personajes, crea podcasts y **charla directamente con tus lecturas**.

---

## 📚 Documentación Oficial
Accede a las guías completas para sacar el máximo partido a BookTracker:

*   📖 **[Manual de Usuario Interactivo (Markdown)](Manual_Usuario_BookTracker.md)** - Ideal para leer directamente en GitHub.
*   📄 **[Manual para Imprimir / PDF (HTML)](Manual_Usuario.html)** - Abre este archivo y pulsa "Guardar como PDF".

---

## 🌟 Bloque 1: Características Premium
BookTracker no es solo un organizador, es una herramienta de análisis literario profundo:

*   **⚡ Biblioteca Inteligente:** Sube PDF/EPUB y deja que la IA identifique metadatos, sinopsis y portadas automáticamente.
*   **📑 Línea de Tiempo Interactiva:** Visualiza los hitos clave de la trama capítulo a capítulo en una línea de tiempo moderna.
*   **👤 Red de Personajes:** Explora las relaciones entre protagonistas con un gráfico interactivo y un panel de detalles detallado (psicología, rol y evolución).
*   **🗺️ Mapa Mental Premium:** Navega por las ideas principales del libro con un mapa de nodos animado y expandible.
*   **🧠 Resumen Global:** Ensayos generados por IA que capturan la esencia, el estilo y el mensaje del autor.
*   **🎙️ Podcast Automático:** Genera un guión y un episodio de audio (TTS) para "escuchar" el análisis de tu libro.
*   **💬 Diálogo Literario:** Haz preguntas difíciles a tus libros. La IA responderá basándose estrictamente en el contenido de la obra.

---

## 🔑 Configuración de las "Llaves" de IA
Para que BookTracker pueda "leer" y "pensar", necesita una llave de acceso:
1.  Entra en la aplicación y **regístrate**.
2.  Haz clic en tu nombre/avatar **abajo a la izquierda** → **Ajustes de IA**.
3.  Introduce una clave de **Google Gemini** (recomendado por su gran ventana de contexto) o **Groq**.
4.  ¡Listo! Ya puedes subir tu primer libro.

---

## ☁️ Bloque 2: Instalación en NAS / Servidor (Vía Portainer)
*Ideal para tener la app encendida 24/7 en tu servidor doméstico.*

1.  **Abre Portainer** → **Stacks** → **Add stack**.
2.  **Nombre:** `booktracker`.
3.  **Repository URL:** Pega la URL de este proyecto de GitHub.
4.  **Compose path:** `docker-compose.yml`.
5.  **Variables de Entorno (Crucial):** Añade estas 3 como mínimo:
    *   `NGINX_PORT`: El puerto para entrar (ej: `8081`).
    *   `SECRET_KEY`: Una clave aleatoria larga.
    *   `SMTP_HOST/USER/PASS`: Si quieres que la app envíe correos de registro.
6.  Pulsa **Deploy the stack**.

---

## 💻 Bloque 3: Instalación en Windows (PC Personal)
*La forma más rápida de probar la app en tu propio ordenador.*

### 1 — Preparar el terreno
1.  Instala **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**.
2.  Ábrelo y espera a que el icono de la ballena esté en verde.

### 2 — Lanzar BookTracker
1.  Descarga este proyecto (Botón **Code** → **Download ZIP**) y descomprímelo.
2.  Haz doble clic en **`BOOKTRACKER.bat`**.
3.  **No cierres la ventana negra.** El navegador se abrirá solo en unos segundos.

### 3 — Notas de Windows
*   Para **apagarlo**: Cierra la ventana negra o dale a "Stop" en Docker Desktop.
*   Para **encenderlo**: Solo vuelve a ejecutar `BOOKTRACKER.bat`. No pierdes tus datos.
*   Si quieres usar correo en Windows, renombra `.env.example` a `.env` y rellena los datos.

---
*Desarrollado con ❤️ para amantes de la lectura y la tecnología.*
<!-- Last Sync: 2026-04-27 17:01:00 -->
