# 📁 Estructura del proyecto

```
booktracker/
│
├── 📄 README.md                    # Documentación principal
├── 📄 QUICKSTART.md                # Guía rápida de despliegue
├── 📄 MIGRATION.md                 # Guía de migración v1→v2
├── 📄 CHANGELOG.md                 # Historial de cambios
├── 📄 docker-compose.yml           # Orquestación de contenedores
├── 📄 setup.sh                     # Script de instalación para NAS
├── 📄 .env.example                 # Plantilla de variables de entorno
├── 📄 .dockerignore                # Archivos excluidos de builds
├── 📄 .gitignore                   # Archivos excluidos de Git
│
├── 🐳 backend/                     # FastAPI + Celery
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # Punto de entrada FastAPI
│       │
│       ├── api/                    # Endpoints REST
│       │   ├── auth.py             # Login, registro, 2FA
│       │   ├── books.py            # CRUD de libros, upload
│       │   ├── analysis.py         # Fases IA, podcast, autores
│       │   └── users.py            # Gestión de usuarios
│       │
│       ├── models/                 # Modelos SQLAlchemy
│       │   ├── user.py             # Usuario (con 2FA)
│       │   └── book.py             # Book, Chapter, Character, etc.
│       │
│       ├── services/               # Lógica de negocio
│       │   ├── ai_analyzer.py      # Motor IA (Gemini/Claude/GPT)
│       │   ├── book_identifier.py  # Fase 1: metadatos
│       │   ├── book_parser.py      # Extracción PDF/EPUB
│       │   └── tts_service.py      # Text-to-speech para podcasts
│       │
│       ├── workers/                # Tareas asíncronas
│       │   ├── celery_app.py       # Configuración Celery
│       │   └── tasks.py            # Fases 1/2/3, podcast, resúmenes
│       │
│       └── core/                   # Configuración central
│           ├── config.py           # Variables de entorno
│           ├── database.py         # Conexiones SQLite
│           └── security.py         # JWT, bcrypt, 2FA
│
├── ⚛️  frontend/                   # React + Vite
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx                # Punto de entrada
│       ├── App.jsx                 # Router principal
│       │
│       ├── pages/                  # Vistas principales
│       │   ├── LoginPage.jsx
│       │   ├── RegisterPage.jsx
│       │   ├── LibraryPage.jsx     # Grid de libros
│       │   ├── BookPage.jsx        # Detalle de libro
│       │   ├── AuthorsPage.jsx     # Lista de autores
│       │   ├── UploadPage.jsx      # Subir PDF/EPUB
│       │   └── ProfilePage.jsx     # Cuenta de usuario
│       │
│       ├── components/             # Componentes reutilizables
│       │   ├── Layout.jsx          # Header + navegación
│       │   └── MindMap.jsx         # Visualización D3.js
│       │
│       └── store/                  # Estado global
│           └── authStore.js        # Zustand - autenticación
│
├── 🌐 nginx/                       # Proxy inverso
│   ├── Dockerfile
│   └── nginx.conf                  # Rutas /api, /data, /
│
└── 📦 data/                        # Volúmenes (en el NAS)
    ├── uploads/                    # PDFs y EPUBs subidos
    ├── covers/                     # Portadas descargadas
    ├── audio/                      # Podcasts MP3
    ├── databases/                  # SQLite
    │   ├── global.db               # Usuarios
    │   └── user_{id}.db            # Libros por usuario
    └── redis/                      # Persistencia de Redis
```

## 🔄 Flujo de datos

### Upload de libro
```
Usuario → NGINX → Backend → /data/uploads/
                         ↓
                      Redis (cola)
                         ↓
                    Celery Worker
                         ↓
              Fase 1: book_identifier.py
              (Open Library + Google Books)
                         ↓
              Fase 2: book_parser.py
              (Detectar capítulos)
                         ↓
              Fase 3: ai_analyzer.py
              (Gemini/Claude: resúmenes)
                         ↓
                  user_{id}.db
```

### Consulta de datos
```
Usuario → NGINX → Backend → SQLite
                         ↓
                     FastAPI
                         ↓
                    JSON Response
                         ↓
                   React Frontend
```

## 🛠️ Stack tecnológico

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| **Frontend** | React 18 + Vite | Interfaz de usuario SPA |
| **API** | FastAPI + Uvicorn | REST API asíncrona |
| **Base de datos** | SQLite | Persistencia (global + por usuario) |
| **IA** | Google Gemini 2.0 Flash | Análisis de libros (gratuito) |
| **Queue** | Celery + Redis | Tareas asíncronas |
| **Parser** | PyMuPDF + ebooklib | Extracción de PDF/EPUB |
| **TTS** | OpenAI / ElevenLabs | Generación de audio |
| **Auth** | JWT + bcrypt + pyotp | Autenticación + 2FA |
| **Proxy** | nginx | Enrutamiento + archivos estáticos |
| **Deploy** | Docker Compose + Portainer | Orquestación de contenedores |

## 📊 Bases de datos

### global.db (usuarios)
```sql
users
├── id (PK)
├── email (unique)
├── username (unique)
├── hashed_password
├── totp_secret
├── totp_enabled
├── email_otp_enabled
└── ...
```

### user_{id}.db (libros del usuario)
```sql
books
├── id (PK)
├── title
├── author
├── isbn
├── file_path
├── status (uploaded → identifying → identified → analyzing → complete)
├── phase1_done, phase2_done, phase3_done
└── ...

chapters
├── id (PK)
├── book_id (FK)
├── title
├── raw_text
├── summary
└── ...

characters
├── id (PK)
├── book_id (FK)
├── name
├── role
├── description
└── ...
```

## 🔐 Seguridad

- ✅ Contraseñas hasheadas con bcrypt
- ✅ JWT con expiración configurable
- ✅ 2FA opcional (TOTP/Email)
- ✅ Rate limiting en Redis
- ✅ Bases de datos aisladas por usuario
- ✅ CORS configurado
- ✅ Variables secretas fuera del código

## 📈 Escalabilidad

| Componente | Escalable | Notas |
|------------|-----------|-------|
| Backend | ✅ Horizontal | Múltiples réplicas detrás de load balancer |
| Worker | ✅ Horizontal | Múltiples workers consumiendo de Redis |
| Redis | ✅ Vertical | Cluster Redis para alta disponibilidad |
| SQLite | ⚠️ Limitado | Considera PostgreSQL para >1000 usuarios |
| nginx | ✅ Horizontal | Múltiples instancias con load balancer |

## 🎯 Próximas mejoras sugeridas

1. **PostgreSQL** en lugar de SQLite para escalabilidad
2. **S3-compatible storage** para uploads/covers/audio
3. **Redis Cluster** para alta disponibilidad
4. **Monitoring** con Prometheus + Grafana
5. **Rate limiting** por usuario con Redis
6. **Búsqueda full-text** con Elasticsearch
7. **CDN** para assets estáticos
8. **WebSockets** para actualizaciones en tiempo real
