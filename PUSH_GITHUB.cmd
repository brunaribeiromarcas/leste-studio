@echo off
setlocal

cd /d "%~dp0"

echo.
echo Leste Studio - Push para GitHub
echo Repositorio esperado: https://github.com/brunaribeiromarcas/leste-studio
echo.

git remote remove origin >nul 2>nul
git remote add origin https://github.com/brunaribeiromarcas/leste-studio.git
git push -u origin main

echo.
pause
