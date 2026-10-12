@echo off
setlocal
cd /d "%~dp0"

if defined VIRTUAL_ENV goto active
if defined CONDA_PREFIX goto active
if not exist ".venv\Scripts\python.exe" call setup.bat
if errorlevel 1 exit /b %ERRORLEVEL%
set "PYTHON_EXE=.venv\Scripts\python.exe"
goto launch

:active
set "PYTHON_EXE=python"

:launch
"%PYTHON_EXE%" run.py --initialize-settings
if errorlevel 1 exit /b %ERRORLEVEL%
"%PYTHON_EXE%" run.py %*
exit /b %ERRORLEVEL%
