# Cordoval Code

Privacy-first desktop AI coding app from Cordoval. Bring your own key, no Cordoval servers, no telemetry.

## How it works
- Electron shell (`src/main`) with a plain-JS UI (`src/renderer`).
- The agent engine is the MIT-licensed OpenCode server, bundled as a local binary and started on
  `127.0.0.1` on a random port. It provides sessions, streaming, tools (read/write/edit, shell with
  approval, glob, grep, LSP), Build and Plan agents, snapshots for undo/revert, and PTY terminals.
- Engine data lives in the app's own user-data folder, isolated from any other OpenCode install.
  Sharing and auto-update are disabled.

## Features
Folder picker and recent projects, sessions sidebar (multi-session), streaming chat with tool cards,
permission prompts (allow once / always / deny), revert to any message and restore, Build/Plan mode,
model picker per session, file tree and viewer, changes with unified diffs, grep search, LSP status,
terminal panel (xterm.js), light lavender and dark themes, and project templates
(React+Vite, Next.js, static site, Electron, Tauri, Android Kotlin Compose, React Native Expo,
Flutter, Node API, FastAPI) with builder system prompts.

## Keys (bring your own)
Settings > Providers: OpenRouter (key or "Sign in with OpenRouter" PKCE), OpenAI, Anthropic,
Google Gemini, Groq, xAI, plus any OpenAI-compatible endpoint, Ollama and LM Studio presets.
Keys are encrypted with Electron safeStorage (Windows DPAPI, macOS Keychain, Linux Secret
Service/kwallet) and handed to the local engine as environment variables only. Free OpenCode Zen
models (for example `opencode/mimo-v2.6-flash-free`) work without a key.

## Develop
    npm install
    ./scripts/fetch-engine.sh      # downloads engine binaries into vendor/
    npm start
    xvfb-run -a node test/smoke.js # UI smoke test + screenshots

## Build
    npm run dist:linux   # dist/Cordoval Code-<ver>.AppImage
    npm run dist:win     # dist/Cordoval Code Setup <ver>.exe (NSIS)
On Windows natively: install Node 20, Git, then `npm install`, `bash scripts/fetch-engine.sh`
(Git Bash) and `npm run dist:win`. Code signing is not configured yet.

## Licence
MIT. Bundles OpenCode (MIT) - see NOTICE.md.
