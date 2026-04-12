@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo    INSTALADOR LOCAL - BOOKTRACKER
echo ==========================================
echo.
echo Este script lanzara BookTracker en tu PC local usando Docker.
echo Asegurate de que Docker Desktop este abierto.
echo.

docker-compose -f docker-compose.local.yml up -d

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Hubo un problema al arrancar los contenedores.
    echo Asegurate de que Docker Desktop este funcionando.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ==========================================
echo    ¡TODO LISTO!
echo ==========================================
echo.
echo Puedes acceder a la app en: http://localhost:8081
echo.
echo Para detener la app, cierra esta ventana (o usa el panel de Docker Desktop).
echo.
pause
