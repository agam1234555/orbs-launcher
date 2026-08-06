@echo off
echo Starting Orbs Radial Launcher...
if not exist node_modules (
  echo Installing dependencies...
  npm install
)
npm start
