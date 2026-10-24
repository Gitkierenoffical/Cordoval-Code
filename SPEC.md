# Cordoval Code - build spec

Electron desktop app (plain JS, no bundler, no framework). Engine = Cordoval's own engine in src/main/engine/, running in the main process.
Brand: name "Cordoval Code", accent #0A5CFF, default light theme soft lavender (bg #F4F2FB, panels #FFFFFF, borders #E3DEF5, text #1B1830), dark theme (bg #0F1020, panels #171930, text #E8E8F5). No emojis anywhere in UI. Never write "company". Font: system-ui; mono: ui-monospace.

## Files
- src/main/main.js      : Electron main. Starts engine, window, IPC.
- src/main/engine/      : the Cordoval engine (HTTP+SSE+WS server, agent loop, tools, permissions, snapshots, MCP, PTY).
- src/main/keys.js      : BYOK store using electron safeStorage (OS keychain backed), saved encrypted in userData/keys.json. Never log keys.
- src/main/preload.js   : contextBridge `window.cordoval` = { engineUrl(), pickFolder(), getKeys() (returns provider ids + masked flags only, never values), setKey(provider, value), deleteKey(provider), setCustom(list), getCustom(), restartEngine(), getSettings(), setSettings(obj), templates(), scaffold(templateId, parentDir, name) }
- src/renderer/index.html, app.js, api.js, styles.css, terminal.js, diff.js, editor.js
- src/templates/*.js    : project templates + system prompts.

## Engine (src/main/engine/)
index.js starts the engine in-process and listens on 127.0.0.1:<random>. Every request must carry the per-run
x-cordoval-token header, which main.js adds (with a loopback Origin) to the window's requests to that port only.
- engine.js: sessions, the streaming agent loop (AI SDK streamText with tools, step parts, abort), /compact, /init,
  commands, revert/unrevert, session diffs. store.js persists one JSON file per session in userData/engine/sessions.
- providers.js: OpenRouter (default), OpenAI, Anthropic, Groq, Google, xAI and OpenAI-compatible endpoints. Keys are
  added as headers inside a fetch wrapper, only for the provider's host. Models are listed from each provider's API.
- tools.js / permission.js / webfetch.js: read, write, edit, list, glob, grep, bash, webfetch, task; allow/ask/deny rules with shell wildcards.
- git.js: snapshots in a private git dir per project (userData/engine/snapshot/<hash>); files.js: tree, content, grep, git status/diff.
- mcp.js (MCP SDK, stdio + streamable HTTP/SSE), pty.js (node-pty over WebSocket), mock-model.js (tests only, CORDOVAL_MOCK_PROVIDER=1).
- util.js redacts every known key from stored, streamed and returned data.
Config: userData/engine/cordoval.json (agents, commands, mcp, permission, model). Project files: .cordoval/{agent,command}/*.md.
Presets: Ollama baseURL http://127.0.0.1:11434/v1, LM Studio http://127.0.0.1:1234/v1.

## Engine HTTP API (all requests take ?directory=<abs project path>)
- GET /session -> list; POST /session {} -> create; DELETE /session/:id; PATCH /session/:id {title}
- GET /session/:id/message -> [{info, parts}]
- POST /session/:id/prompt_async {model:{providerID,modelID}, agent:"build"|"plan", parts:[{type:"text",text}]}  (returns 204, results stream via events)
- POST /session/:id/abort
- POST /session/:id/revert {messageID} ; POST /session/:id/unrevert
- GET /event  (SSE, `data: {type, properties}`). Types: message.updated {info}, message.part.updated {part}, message.part.delta {sessionID,messageID,partID,field,delta} (append delta to part[field]), session.updated {info}, session.status {sessionID,status:{type:"busy"|"idle"}}, session.diff {sessionID,diff:[{file,before,after,additions,deletions}]}, permission.asked {id,sessionID,permission,patterns,metadata}, permission.replied, session.error.
- POST /permission/:requestID/reply {reply:"once"|"always"|"reject"}
- GET /permission (pending), GET /permission/rules[?all=1] (saved always-allow rules: {id,directory,key,pattern}), DELETE /permission/rules/:id
- GET /session?children=1 includes subagent sub-sessions (parentID), hidden by default.
- Tools also include webfetch (permission key webfetch, value = host) and task (read-only subagent). Defaults when unset: webfetch ask, external_directory ask; Plan denies webfetch. Assistant info.cost is USD or null when the price is unknown.
- GET /config/providers -> {providers:[{id,name,models:{id:{id,name}}}], default:{}}
- GET /file?path=<rel> -> [{name,path,absolute,type:"file"|"directory",ignored}] ; GET /file/content?path=<rel> -> {type,content}
- GET /file/status -> [{path,added,removed,status}]
- GET /find?pattern=<text> (grep) ; GET /find/file?query=<q>
- GET /lsp -> lsp server status
- POST /pty {command?,cwd} -> {id} ; WebSocket ws://host/pty/:id/connect?directory=... (raw bytes both ways); PUT /pty/:id {size:{rows,cols}}; DELETE /pty/:id
Part types: text{text}, reasoning{text}, tool{tool, state:{status:"pending"|"running"|"completed"|"error", input, output, title, error}}, step-start, step-finish, patch{files}.

## UI layout
- Title bar area: logo (assets/icon.svg) + "Cordoval Code" + current project name + theme toggle + Settings button.
- Welcome screen when no project: "Open folder", "New project from template", recent projects list (localStorage).
- Left sidebar: project switcher, "New session" button, session list (title, relative time, busy dot), delete/rename via context buttons.
- Center: chat. Messages render markdown (marked). Streaming text via deltas. Tool parts as collapsible cards: tool name, title, status, input, output (pre). Reasoning collapsed. Each user message has "Revert to here" button (POST revert). When session.revert set, show banner with "Restore" (unrevert).
- Composer: textarea (Enter send, Shift+Enter newline), mode toggle Build/Plan (agent), model picker per session (select grouped by provider from /config/providers; remember per session in localStorage; default openrouter/openai/gpt-5.4-mini), Stop button while busy.
- Permission requests: inline card in chat with Allow once / Always allow / Deny.
- Right panel tabs: Files (lazy tree from /file, click opens a Monaco editor tab in the center), Changes (session.diff + /file/status; unified diff viewer using `diff` package createTwoFilesPatch, colored lines), Search (grep via /find), Diagnostics (/lsp status).
- Bottom: toggleable Terminal panel with xterm.js (node_modules/@xterm/xterm) connected to engine pty websocket.
- Settings modal: tabs Providers (OpenRouter, OpenAI, Anthropic, Google Gemini, Groq, xAI: password input, Save, Remove, "Stored in OS keychain" state; OpenRouter "Sign in with OpenRouter" button performing PKCE OAuth: open https://openrouter.ai/auth?callback_url=http://127.0.0.1:<port>/callback&code_challenge=..&code_challenge_method=S256 in browser, local http listener receives ?code, POST https://openrouter.ai/api/v1/auth/keys {code,code_verifier,code_challenge_method:"S256"} -> {key}, store it), Custom endpoints (name, base URL, API key optional, model ids comma separated; Ollama + LM Studio presets), Appearance (Light/Dark), Privacy text: "No Cordoval servers. No telemetry. Keys stay on this device."
- Templates (src/templates/index.js): array of {id,name,category,description,prompt,system}. Categories Web (React+Vite, Next.js, static site), Desktop (Electron, Tauri), Mobile (Android Kotlin Jetpack Compose, React Native Expo, Flutter), Backend (Node API, Python FastAPI). Scaffold: create folder parent/name, open it as project, create session, send prompt_async with agent "build" and system = template.system + general builder system prompt (src/templates/system.js: plan first, create full project structure, run install/build/test commands, fix errors, summarise).
