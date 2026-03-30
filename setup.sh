#!/bin/bash
# ============================================================
# BookTracker - Script de instalación para Synology NAS
# ============================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       BookTracker - Setup v2.0       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# Crear directorios de datos
echo -e "${BOLD}Creando directorios...${NC}"
mkdir -p /volume1/docker/booktracker/data/{uploads,covers,audio,databases,redis}
chmod -R 755 /volume1/docker/booktracker/data
echo -e "${GREEN}✓ Directorios creados${NC}"
echo ""

echo -e "${GREEN}${BOLD}Setup completado!${NC}"
echo ""
echo -e "${BOLD}Próximos pasos:${NC}"
echo "  1. En Portainer → Stacks → Add stack → Repository"
echo "  2. Repository URL: https://github.com/TU_USUARIO/booktracker"
echo "  3. Compose path: docker-compose.yml"
echo "  4. Añadir variables de entorno (ver README.md)"
echo "  5. Deploy the stack"
echo ""
echo "Acceso: http://$(hostname -I | awk '{print $1}' 2>/dev/null || echo 'IP-NAS'):8080"
