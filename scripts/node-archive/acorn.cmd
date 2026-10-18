@echo off
rem Runs acorn on the archive's own Node.js runtime, from any working directory.
setlocal

rem Without it, acorn falls back to the desktop app's data root, which this Node must not share.
if not defined ACORN_DATA_DIR (
  echo acorn: set ACORN_DATA_DIR to a folder for the Node's data, for example set ACORN_DATA_DIR=%%LOCALAPPDATA%%\acorn-node. The archive's README.md covers installing. 1>&2
  exit /b 1
)

"%~dp0..\runtime\node.exe" --disable-warning=ExperimentalWarning "%~dp0..\lib\bin\acorn.mjs" %*
exit /b %ERRORLEVEL%
