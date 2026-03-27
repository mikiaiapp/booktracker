#!/bin/bash
# ============================================================
# BookTracker - Script de instalación para Synology NAS
# ============================================================
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       BookTracker - Setup v1.0       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# Check .env
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}⚠  No se encontró .env. Creando desde plantilla...${NC}"
  cp .env.example .env

  # Generate random secret key
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))" 2>/dev/null || \
           openssl rand -base64 48 | tr -d '\n')
  sed -i "s/cambia_esto_por_un_secreto_muy_largo_y_aleatorio_min32chars/$SECRET/" .env

  echo -e "${GREEN}✓ .env creado. ${BOLD}Edítalo antes de continuar:${NC}"
  echo "  nano .env"
  echo ""
  echo "  Variables requeridas:"
  echo "  - ANTHROPIC_API_KEY o OPENAI_API_KEY"
  echo "  - SMTP_* (para 2FA por email, opcional)"
  echo ""
  read -p "¿Continuar de todas formas? [s/N] " confirm
  [[ "$confirm" != "s" && "$confirm" != "S" ]] && exit 0
fi

# Create data directories
echo -e "${BOLD}Creando directorios de datos...${NC}"
mkdir -p data/{uploads,audio,covers,databases}
chmod 755 data data/{uploads,audio,covers,databases}
echo -e "${GREEN}✓ Directorios creados${NC}"

# Build and start
echo ""
echo -e "${BOLD}Construyendo imágenes Docker...${NC}"
docker compose build --no-cache

echo ""
echo -e "${BOLD}Iniciando servicios...${NC}"
docker compose up -d

# Wait for backend
echo ""
echo -e "${BOLD}Esperando que el backend arranque...${NC}"
for i in {1..30}; do
  if curl -sf http://localhost:$(grep NGINX_PORT .env | cut -d= -f2 || echo 8080)/api/docs > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend listo${NC}"
    break
  fi
  echo -n "."
  sleep 2
done

PORT=$(grep "^NGINX_PORT" .env | cut -d= -f2 | tr -d ' ' || echo "8080")
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        BookTracker está disponible en:       ║${NC}"
echo -e "${GREEN}${BOLD}║   http://localhost:${PORT}                      ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "Comandos útiles:"
echo "  docker compose logs -f backend   # Ver logs del backend"
echo "  docker compose logs -f worker    # Ver logs del worker IA"
echo "  docker compose down              # Detener todos los servicios"
echo "  docker compose pull              # Actualizar imágenes"
