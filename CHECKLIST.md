# ✅ Checklist de verificación pre-deploy

Usa esta lista antes de hacer el primer despliegue o después de grandes cambios.

## 📋 Preparación del NAS

- [ ] Acceso SSH al NAS funcionando
- [ ] Docker instalado en el NAS
- [ ] Portainer instalado y accesible
- [ ] Espacio en disco: mínimo 10 GB libres
- [ ] Permisos de escritura en `/volume1/docker/`

```bash
# Verificar requisitos
ssh admin@IP-NAS
docker --version
docker ps
df -h /volume1
```

## 🔑 Variables de entorno

- [ ] `SECRET_KEY` generada (mín. 32 caracteres aleatorios)
- [ ] `GEMINI_API_KEY` obtenida de aistudio.google.com
- [ ] `GOOGLE_API_KEY` = mismo valor que GEMINI_API_KEY
- [ ] `AI_MODEL` = gemini-2.0-flash
- [ ] ⚠️ Clave de Gemini creada SIN billing activado

```bash
# Generar SECRET_KEY aleatorio
openssl rand -base64 48
```

## 📁 Estructura de carpetas

- [ ] `/volume1/docker/booktracker/data/uploads` creado
- [ ] `/volume1/docker/booktracker/data/covers` creado
- [ ] `/volume1/docker/booktracker/data/audio` creado
- [ ] `/volume1/docker/booktracker/data/databases` creado
- [ ] `/volume1/docker/booktracker/data/redis` creado
- [ ] Permisos 755 en todas las carpetas

```bash
# Crear estructura
ssh admin@IP-NAS
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
chmod -R 755 /volume1/docker/booktracker/data
```

## 🐙 Repositorio GitHub

- [ ] Código pusheado a GitHub
- [ ] Rama principal (main/master) accesible
- [ ] Si es privado: Personal Access Token generado
- [ ] Token con scope `repo` activado
- [ ] URL del repo copiada

## 🐳 Configuración Portainer

- [ ] Portainer accesible en `http://IP-NAS:9000`
- [ ] Stack name: `booktracker`
- [ ] Repository URL configurada
- [ ] Branch: `refs/heads/main`
- [ ] Compose path: `docker-compose.yml`
- [ ] Autenticación configurada (si repo privado)
- [ ] Variables de entorno añadidas
- [ ] Puerto 8080 libre (o cambiado en NGINX_PORT)

## 🚀 Deploy

- [ ] Clic en "Deploy the stack"
- [ ] Sin errores en logs de inicio
- [ ] Esperar 3-5 minutos (primera vez)
- [ ] Todos los contenedores "running"

```bash
# Verificar contenedores
ssh admin@IP-NAS
docker ps | grep booktracker

# Ver logs
docker logs booktracker-backend
docker logs booktracker-worker
docker logs booktracker-redis
```

## ✅ Verificación post-deploy

- [ ] Web accesible en `http://IP-NAS:8080`
- [ ] Página de login carga correctamente
- [ ] Registro de usuario funciona
- [ ] Login funciona
- [ ] Subir libro test (PDF pequeño)
- [ ] Fase 1 completa (metadatos)
- [ ] Fase 2 completa (capítulos)
- [ ] Fase 3 completa (resúmenes)
- [ ] Portada descargada
- [ ] No hay errores en logs

## 🔧 Test completo

```bash
# 1. Registrar usuario
# http://IP-NAS:8080/register

# 2. Subir libro de prueba
# Usar un PDF pequeño (5-10 páginas)

# 3. Verificar progreso
docker logs booktracker-worker -f

# 4. Revisar base de datos
ssh admin@IP-NAS
ls -lh /volume1/docker/booktracker/data/databases/
```

## 🐛 En caso de error

### Backend no arranca
```bash
docker logs booktracker-backend --tail 50
# Revisar SECRET_KEY, formato de variables
```

### Worker no procesa
```bash
docker logs booktracker-worker --tail 50
docker logs booktracker-redis
# Verificar GEMINI_API_KEY
```

### "Quota exceeded"
```bash
# Tu clave tiene billing activado
# Crear nueva en aistudio.google.com SIN billing
```

### Frontend no carga
```bash
docker logs booktracker-frontend
docker logs booktracker-nginx
# Verificar puerto 8080 libre
```

## 📊 Métricas de éxito

- [ ] Tiempo de deploy inicial: < 10 min
- [ ] Tiempo de login: < 2 seg
- [ ] Tiempo de upload: < 5 seg
- [ ] Fase 1 (metadatos): < 30 seg
- [ ] Fase 2 (estructura): < 1 min
- [ ] Fase 3 (resúmenes): < 5 min (libro 200 pág)
- [ ] Memoria backend: < 500 MB
- [ ] Memoria worker: < 1 GB

## 🎯 Opcional pero recomendado

- [ ] Configurar 2FA (TOTP o Email)
- [ ] Cambiar puerto por defecto (8080)
- [ ] Configurar SMTP para 2FA por email
- [ ] Configurar backup automático
- [ ] Documentar URL de acceso en Wiki/Notion
- [ ] Añadir marcador en navegador

## 📝 Notas

```
Fecha de deploy: _______________
URL de acceso: http://_________:____
Usuario admin: _______________
Versión desplegada: _______________
Notas adicionales:
_________________________________
_________________________________
```

---

**✅ Checklist completado** → Todo listo para usar BookTracker

**❌ Algún punto falló** → Consulta [QUICKSTART.md](QUICKSTART.md) o [README.md](README.md)
