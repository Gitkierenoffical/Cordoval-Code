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

### New in 0.2.0
Built-in Monaco editor (tabs, save, syntax highlighting, inline diagnostics), file and image
attachments (button, drag and drop, paste), slash commands (/new, /plan, /build, /undo, /redo,
/model, /init, /compact, /clear, /theme, /terminal, /settings, /help, plus project commands),
friendly model names with Free labels, keychain warning, and a lighter OpenCode-style layout.
Tests: `test/smoke.js`, `test/e2e.js`, `test/editor.js`, `test/composer.js`, `test/templates.js`.

- Customise panel (Ctrl+;): MCP servers (local and remote, enable/disable, connect, OAuth sign-in, tool lists), custom agents and slash commands (global config or project `.opencode/`), and per-tool permissions with shell command rules.
- Custom primary agents appear next to Build and Plan.
- Command palette (Ctrl+K or Ctrl+Shift+P), Go to file (Ctrl+P), OpenCode desktop keybinds and a shortcuts panel (Ctrl+/).
- 37 colour themes: Cordoval lavender (default) plus OpenCode's desktop themes, each in light and dark.
- Session history: search across sessions, rename, delete, export to Markdown, export and import JSON. Public share is always off.

- @-mentions in the message box for files, folders and agents, with autocomplete. Mentioned files are sent as context.
- Reasoning effort / model variant picker per session (Ctrl+Shift+D cycles).
- Per-line review comments on the Changes diff, sent to the agent in one message.
- Project tabs in the title bar (Ctrl+T, Ctrl+W, Ctrl+Tab).
- Rebindable keyboard shortcuts (Ctrl+/ then click a shortcut).
- Customise changes to agents apply live; other changes wait until no session is running, then restart the engine, so nothing in flight is cut off.

## Keys (bring your own)
Settings > Providers: OpenRouter (key or "Sign in with OpenRouter" PKCE), OpenAI, Anthropic,
Google Gemini, Groq, xAI, plus any OpenAI-compatible endpoint, Ollama and LM Studio presets.
Keys are encrypted with Electron safeStorage (Windows DPAPI, Linux Secret
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
Cross-building the Windows installer on Linux needs wine64 + wine32 (i386 multiarch) and a
clean prefix, e.g. `WINEPREFIX=~/.wine-cordoval wineboot -i` first.
On Windows natively: install Node 20, Git, then `npm install`, `bash scripts/fetch-engine.sh`
(Git Bash) and `npm run dist:win`. Code signing is not configured yet.

## Licence
MIT. Bundles OpenCode (MIT) - see NOTICE.md.

## Tests

Under `test/` (Playwright + Xvfb): smoke, e2e, slash, templates, editor, lsp, lsp-native, vision, fallback, updater, themes, history, customize, mcp-auth, agents, deny, live-apply, mentions, variant, review, tabs-keys. Set `CORDOVAL_USER_DATA` to run against a throwaway profile.
