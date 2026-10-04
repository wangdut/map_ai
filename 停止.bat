@echo off
rem Keep this file ASCII-only: cmd parses .bat by byte offset, so non-ASCII text after chcp 65001 breaks the parser. All messages live in stop.mjs.
chcp 65001 >nul
cd /d "%~dp0"
node stop.mjs
