#!/bin/bash
# ============================================================
# BookTracker - Script de instalación para Synology NAS
# ============================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       BookTracker - Setup v1.0       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# Crear directorios de datos
echo -e "${BOLD}Creando directorios...${NC}"
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
mkdir -p /volume1/docker/booktracker/overrides
chmod -R 755 /volume1/docker/booktracker/data
chmod -R 755 /volume1/docker/booktracker/overrides
echo -e "${GREEN}✓ Directorios creados${NC}"

# Copiar ficheros override (si existen junto al script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for f in ai_analyzer.py book_identifier.py; do
  if [ -f "$SCRIPT_DIR/backend/app/services/$f" ]; then
    cp "$SCRIPT_DIR/backend/app/services/$f" /volume1/docker/booktracker/overrides/$f
    echo -e "${GREEN}✓ Override copiado: $f${NC}"
  fi
done

# Crear .env si no existe
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 48 | tr -d '\n')
  sed -i "s/cambia_esto_por_un_secreto.*/$SECRET/" "$SCRIPT_DIR/.env"
  echo -e "${YELLOW}⚠  .env creado. Edítalo con tus API keys: nano $SCRIPT_DIR/.env${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}Setup completado. Ahora despliega el stack en Portainer.${NC}"
