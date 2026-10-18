@echo off
rem Runs acorn on the archive's own Node.js runtime, from any working directory.
setlocal

rem Without it, acorn falls back to the desktop app's data root, which this Node must not share.
if not defined ACORN_DATA_DIR (
  echo acorn: run this archive's install.ps1, which gives the acorn command a data folder, or set ACORN_DATA_DIR to a folder for the Node's data. 1>&2
  exit /b 1
)

"%~dp0..\runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0..\lib\bin\acorn.mjs" %*
exit /b %ERRORLEVEL%
