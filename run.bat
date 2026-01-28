@echo off
setlocal
title Production Line Staffing

set "ROOT=%~dp0"
set "DIST=%ROOT%dist"
if not exist "%DIST%\index.html" (
  echo ERROR: dist folder not found.
  echo Run "npm install" then "npm run build" once on a machine with Node.
  echo See PORTABLE.md for instructions.
  pause
  exit /b 1
)

set "PORT=5173"

:: Prefer Python (user has it on target machine)
where python >nul 2>&1
if %errorlevel% equ 0 (
  echo Starting server with Python...
  echo Open: http://localhost:%PORT%
  start "" "http://localhost:%PORT%"
  python -m http.server %PORT% --directory "%DIST%"
  goto :eof
)

:: Fallback: Node
where npx >nul 2>&1
if %errorlevel% equ 0 (
  echo Starting server with Node...
  echo Open: http://localhost:%PORT%
  start "" "http://localhost:%PORT%"
  npx --yes serve "%DIST%" -l %PORT%
  goto :eof
)

echo.
echo No Python or Node found. Install Python from https://python.org
echo See PORTABLE.md for full instructions.
pause
exit /b 1
