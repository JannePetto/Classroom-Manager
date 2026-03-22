@echo off
setlocal

set "PYTHON_CMD="
py -3.13 -V >nul 2>&1 && set "PYTHON_CMD=py -3.13"
if not defined PYTHON_CMD py -3.12 -V >nul 2>&1 && set "PYTHON_CMD=py -3.12"
if not defined PYTHON_CMD set "PYTHON_CMD=py -3"

echo Using %PYTHON_CMD%
echo Installing dependencies...
%PYTHON_CMD% -m ensurepip --upgrade >nul 2>&1
%PYTHON_CMD% -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :error
%PYTHON_CMD% -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo.
echo Building slave.exe ...
%PYTHON_CMD% -m PyInstaller --clean slave.spec
if errorlevel 1 goto :error

echo.
echo Done! EXE is in the dist\ folder.
pause
exit /b 0

:error
echo.
echo Build failed.
pause
exit /b 1
