# 🚀 Guía Rápida de Despliegue

## Para nuevos usuarios

### Paso 1: Preparar el NAS (2 minutos)

```bash
# Conectar por SSH al NAS
ssh admin@IP-NAS

# Ejecutar comando único
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
```

### Paso 2: Desplegar en Portainer (5 minutos)

1. **Portainer → Stacks → Add stack**
2. Seleccionar **"Repository"**
3. Configurar:
   ```
   Name: booktracker
   Repository URL: https://github.com/mikiaiapp/booktracker
   Repository reference: refs/heads/main
   Compose path: docker-compose.yml
   ```

4. **Environment variables** (obligatorias):
   ```
   SECRET_KEY=tu_clave_secreta_minimo_32_caracteres_aleatorios
   GEMINI_API_KEY=AIza...
   GOOGLE_API_KEY=AIza...
   AI_MODEL=gemini-2.0-flash
   ```

   > 💡 Obtén tu API key gratuita en [aistudio.google.com](https://aistudio.google.com)
   > ⚠️ **Importante**: Crear la clave en AI Studio con "Create API key in new project" (sin billing)

5. **Deploy the stack** → Esperar 3-5 minutos

6. **Acceder**: `http://IP-NAS:8080`

---

## Para actualizar código

### Opción A: Desde tu máquina

```bash
# 1. Edita archivos localmente
# 2. Commit y push
git add .
git commit -m "Nueva funcionalidad"
git push origin main

# 3. En Portainer → Stacks → booktracker → "Pull and redeploy"
```

### Opción B: Editar directamente en GitHub

```
1. Edita archivos en GitHub web
2. Commit changes
3. Portainer → "Pull and redeploy"
```

---

## Variables de entorno opcionales

### Para podcast (audio TTS)
```
OPENAI_API_KEY=sk-...
TTS_PROVIDER=openai
```

### Para usar Claude en lugar de Gemini
```
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-4
```

### Para 2FA por email
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu_email@gmail.com
SMTP_PASS=tu_app_password_de_google
SMTP_FROM=noreply@booktracker.local
```

### Para cambiar el puerto web
```
NGINX_PORT=8080
```

---

## Comandos útiles

```bash
# Ver logs en tiempo real
docker logs booktracker-backend -f
docker logs booktracker-worker -f

# Ver estado de contenedores
docker ps | grep booktracker

# Reiniciar un servicio
docker restart booktracker-worker

# Backup de datos
cd /volume1/docker/booktracker
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# Ver uso de recursos
docker stats booktracker-backend booktracker-worker
```

---

## Solución rápida de problemas

### Backend no arranca
```bash
docker logs booktracker-backend --tail 50
docker restart booktracker-backend
```

### Worker no procesa libros
```bash
docker logs booktracker-worker --tail 50
docker restart booktracker-worker
docker logs booktracker-redis
```

### "Quota exceeded"
- Tu clave de Gemini tiene billing activado
- Crear nueva clave en AI Studio sin billing
- Límite gratuito: 1,500 peticiones/día

### No se ven las portadas
```bash
chmod -R 755 /volume1/docker/booktracker/data/covers
docker restart booktracker-nginx
```

---

## Estructura de datos en el NAS

```
/volume1/docker/booktracker/
└── data/
    ├── uploads/      ← PDFs y EPUBs subidos
    ├── covers/       ← Portadas descargadas
    ├── audio/        ← Podcasts generados (MP3)
    ├── databases/    ← SQLite (global.db + user_*.db)
    └── redis/        ← Cola de tareas Celery
```

---

## Seguridad

✅ **Recomendaciones:**
- Usa contraseñas fuertes (mín. 12 caracteres)
- Activa 2FA (TOTP o Email)
- Cambia el puerto por defecto si lo expones a Internet
- Considera usar un reverse proxy con HTTPS (nginx, Caddy, Traefik)
- Haz backups regulares de `/data/databases/`

❌ **No hacer:**
- Subir `.env` al repositorio
- Compartir tu `SECRET_KEY`
- Exponer el puerto directamente a Internet sin HTTPS
- Usar la misma contraseña para todo

---

## Recursos adicionales

- 📖 [README completo](README.md)
- 🔄 [Guía de migración v1→v2](MIGRATION.md)
- 📋 [Changelog](CHANGELOG.md)
- 🐛 [Reportar issues](https://github.com/mikiaiapp/booktracker/issues)

---

**¿Primera vez desplegando en Portainer?**  
La primera compilación tarda 5-15 minutos. Ten paciencia. Después, los redeploys son mucho más rápidos (~2-3 min).
