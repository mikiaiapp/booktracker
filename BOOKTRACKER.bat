@echo off
setlocal enabledelayedexpansion

:: =================================================================
:: 📚 BookTracker - Lanzador para Windows (Modo Premium)
:: =================================================================

echo.
echo  [1/3] Verificando Docker Desktop...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [!] ERROR: Docker no esta instalado o no se esta ejecutando.
    echo      Por favor, abre Docker Desktop y espera a que la ballena este verde.
    echo.
    pause
    exit /b
)

echo  [2/3] Arrancando contenedores de BookTracker...
docker-compose -f docker-compose.local.yml up -d

echo  [3/3] Preparando interfaz premium...
echo      Esperando a que los servicios esten listos (5s)...
timeout /t 5 /nobreak >nul

echo.
echo  [🚀] EXITO: BookTracker se esta ejecutando.
echo      Abriendo aplicacion en tu navegador...
echo.

:: Abrir el navegador por defecto
start http://localhost:8081

echo  =================================================================
echo  RECUERDA: No cierres esta ventana si quieres ver los logs. 
echo  Tambien puedes gestionar todo visualmente desde Docker Desktop.
echo  =================================================================
echo.

:: Mantener la ventana abierta para ver logs en vivo del backend si el usuario quiere
docker logs -f booktracker-api-local
