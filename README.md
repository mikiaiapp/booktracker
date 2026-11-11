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
2.  Haz clic en tu nombre/avatar **abajo a la izquierda** → **Claves de IA**.
3.  Introduce una clave de **Google Gemini** (recomendado por su gran ventana de contexto) o **Groq**.
    Cada usuario usa **sus propias claves** (menú de usuario → *Claves de IA*): se guardan cifradas y nunca se devuelven completas. Solo en un libro compartido, el audio puede generarse con la clave de OpenAI del propietario del libro si quien lo escucha no tiene la suya; nunca se usan las claves del servidor ni las de otros usuarios.
4.  ¡Listo! Ya puedes subir tu primer libro.

---

## ☁️ Bloque 2: Instalación en NAS / Servidor (Vía Portainer)
*Ideal para tener la app encendida 24/7 en tu servidor doméstico.*

1.  **Abre Portainer** → **Stacks** → **Add stack**.
2.  **Nombre:** `booktracker`.
3.  **Repository URL:** Pega la URL de este proyecto de GitHub.
4.  **Compose path:** `docker-compose.yml`.
5.  **Variables de Entorno (Crucial):** Añade estas como mínimo (el detalle está en «Cuentas de usuario y envío de correo»):
    *   `NGINX_PORT`: El puerto para entrar (ej: `8081`).
    *   `SECRET_KEY`: Una clave aleatoria larga (**obligatoria**: sin ella la aplicación no arranca).
    *   `APP_URL`: La dirección pública de la app, con `https://` (se usa en los enlaces de los correos).
    *   El correo, para que los usuarios nuevos puedan verificar su cuenta: `SMTP_*` o `CENTRAL_EMAIL_*`.
6.  Pulsa **Deploy the stack**.

---

## 👤 Cuentas de usuario y envío de correo

**Cómo funcionan las cuentas**
*   **Registro con verificación del correo:** al crear la cuenta se envía un enlace de activación; hasta que se pulsa, no se puede entrar. Si no llega, se puede reenviar desde la pantalla de acceso.
*   **Doble factor con app autenticadora (TOTP)** (Google Authenticator, Authy, 1Password…): se activa desde el perfil, una vez dentro.
*   **Recuperar la contraseña** por correo: se envía un enlace válido durante 1 hora.

Para que todo esto funcione, **la aplicación necesita poder enviar correo**. Sin configurarlo, los mensajes no se envían (se escriben en el registro del contenedor) y los usuarios nuevos no podrán verificar su cuenta. Hay **dos formas** de configurarlo; elige una.

| Variable | ¿Obligatoria? | Descripción |
|---|---|---|
| `SECRET_KEY` | **Sí** | Clave con la que se firman las sesiones. Larga y aleatoria (64 caracteres o más, por ejemplo `openssl rand -hex 48`). **Sin ella la aplicación no arranca.** Si la cambias, todos tendrán que volver a iniciar sesión. También cifra las claves de IA de los usuarios en la base de datos (AES-256-GCM): si la cambias, las sesiones se cierran y cada usuario tendrá que volver a introducir sus claves. |
| `APP_URL` | Recomendada | Dirección pública de la app con protocolo, por ejemplo `https://libros.tudominio.com`. Se usa en los enlaces de los correos. |

**Opción A · No tengo un gestor de correo propio → usa un servidor SMTP.** Es la más sencilla: pon los datos de tu proveedor (Gmail, el correo de tu dominio, Brevo, etc.).

| Variable | Descripción |
|---|---|
| `SMTP_HOST` | Servidor SMTP, por ejemplo `smtp.gmail.com`. **Con ella se activa el envío.** |
| `SMTP_PORT` | Puerto (por defecto `587`; el `465` usa TLS directo). |
| `SMTP_SECURE` | `true` fuerza TLS directo; por defecto solo en el puerto `465` (en el `587` se usa STARTTLS). |
| `SMTP_USER` / `SMTP_PASS` | Usuario y contraseña, si el servidor exige autenticación. En Gmail hay que usar una **contraseña de aplicación** (requiere tener activada la verificación en dos pasos), no la contraseña normal de la cuenta. |
| `SMTP_FROM` | Dirección del remitente (por defecto, `SMTP_USER`). |

**Opción B · Ya tengo un gestor de correo → BookTracker le delega el envío.** Si ya dispones de un servicio propio que centraliza el correo de tus aplicaciones, indica su dirección y su clave. Debe aceptar `POST <URL>/send` con un JSON `{ "to", "subject", "text", "html", "key", "fromName" }` y responder `{ "success": true }`.

| Variable | Descripción |
|---|---|
| `CENTRAL_EMAIL_URL` | Dirección del servicio de correo (por ejemplo, `http://mi-servicio:3001`). |
| `CENTRAL_EMAIL_KEY` | Clave que se envía en el campo `key` para autorizar el envío. Trátala como una contraseña: larga, aleatoria y distinta en cada instalación. |

Si defines **las dos**, tiene prioridad la opción B.

> **Actualizar desde una versión anterior:** los usuarios que ya existían quedan marcados como verificados automáticamente, así que nadie se queda sin acceso. El 2FA por código al correo se ha retirado: solo se ofrece la app autenticadora.

> [!IMPORTANT]
> **Seguridad.** No subas nunca un `.env` con valores reales a Git: define las claves en las variables del stack. Si alguna vez publicaste una clave por error, **cámbiala**: borrarla del repositorio no basta, porque queda en el historial.

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
