# Cordoval Code - build spec

Electron desktop app (plain JS, no bundler, no framework). Engine = bundled OpenCode server binary (MIT).
Brand: name "Cordoval Code", accent #0A5CFF, default light theme soft lavender (bg #F4F2FB, panels #FFFFFF, borders #E3DEF5, text #1B1830), dark theme (bg #0F1020, panels #171930, text #E8E8F5). No emojis anywhere in UI. Never write "company". Font: system-ui; mono: ui-monospace.

## Files
- src/main/main.js      : Electron main. Starts engine, window, IPC.
- src/main/engine.js    : spawn engine, find free port, wait for GET /global/health.
- src/main/keys.js      : BYOK store using electron safeStorage (OS keychain backed), saved encrypted in userData/keys.json. Never log keys.
- src/main/preload.js   : contextBridge `window.cordoval` = { engineUrl(), pickFolder(), getKeys() (returns provider ids + masked flags only, never values), setKey(provider, value), deleteKey(provider), setCustom(list), getCustom(), restartEngine(), getSettings(), setSettings(obj), templates(), scaffold(templateId, parentDir, name) }
- src/renderer/index.html, app.js, api.js, styles.css, terminal.js, diff.js, editor.js
- src/templates/*.js    : project templates + system prompts.

## Engine (src/main/engine.js)
binary path: app.isPackaged ? path.join(process.resourcesPath,'engine', win?'opencode.exe':'opencode') : path.join(__dirname,'../../vendor', {linux:'linux',win32:'win',darwin:'mac'}[process.platform], name).
spawn(bin, ['serve','--hostname','127.0.0.1','--port',String(port)], {env}).
env: process.env plus XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_STATE_HOME under app.getPath('userData')/engine/*, OPENCODE_DISABLE_AUTOUPDATE=1, OPENCODE_DISABLE_SHARE=1, and API keys as env vars:
openrouter->OPENROUTER_API_KEY, openai->OPENAI_API_KEY, anthropic->ANTHROPIC_API_KEY, google->GOOGLE_GENERATIVE_AI_API_KEY, groq->GROQ_API_KEY, xai->XAI_API_KEY.
OPENCODE_CONFIG_CONTENT = JSON config: {"$schema":"https://opencode.ai/config.json","share":"disabled","autoupdate":false, "provider":{...custom}} where custom OpenAI-compatible endpoints become
 {"<id>":{"npm":"@ai-sdk/openai-compatible","name":"<name>","options":{"baseURL":"<url>","apiKey":"<key>"},"models":{"<model>":{"name":"<model>"}}}}.
Presets: Ollama baseURL http://127.0.0.1:11434/v1, LM Studio http://127.0.0.1:1234/v1.
Kill engine on app quit. restartEngine() restarts after key changes.

## Engine HTTP API (all requests take ?directory=<abs project path>)
- GET /session -> list; POST /session {} -> create; DELETE /session/:id; PATCH /session/:id {title}
- GET /session/:id/message -> [{info, parts}]
- POST /session/:id/prompt_async {model:{providerID,modelID}, agent:"build"|"plan", parts:[{type:"text",text}]}  (returns 204, results stream via events)
- POST /session/:id/abort
- POST /session/:id/revert {messageID} ; POST /session/:id/unrevert
- GET /event  (SSE, `data: {type, properties}`). Types: message.updated {info}, message.part.updated {part}, message.part.delta {sessionID,messageID,partID,field,delta} (append delta to part[field]), session.updated {info}, session.status {sessionID,status:{type:"busy"|"idle"}}, session.diff {sessionID,diff:[{file,before,after,additions,deletions}]}, permission.asked {id,sessionID,permission,patterns,metadata}, permission.replied, session.error.
- POST /permission/:requestID/reply {reply:"once"|"always"|"reject"}
- GET /config/providers -> {providers:[{id,name,models:{id:{id,name}}}], default:{}}
- GET /file?path=<rel> -> [{name,path,absolute,type:"file"|"directory",ignored}] ; GET /file/content?path=<rel> -> {type,content}
- GET /file/status -> [{path,added,removed,status}]
- GET /find?pattern=<text> (grep) ; GET /find/file?query=<q>
- GET /lsp -> lsp server status
- POST /pty {command?,cwd} -> {id} ; WebSocket ws://host/pty/:id/connect?directory=... (raw bytes both ways); PUT /pty/:id {size:{rows,cols}}; DELETE /pty/:id
Part types: text{text}, reasoning{text}, tool{tool, state:{status:"pending"|"running"|"completed"|"error", input, output, title, error}}, step-start, step-finish, patch{files}.

## UI layout (OpenCode desktop style)
- Title bar area: logo (assets/icon.svg) + "Cordoval Code" + current project name + theme toggle + Settings button.
- Welcome screen when no project: "Open folder", "New project from template", recent projects list (localStorage).
- Left sidebar: project switcher, "New session" button, session list (title, relative time, busy dot), delete/rename via context buttons.
- Center: chat. Messages render markdown (marked). Streaming text via deltas. Tool parts as collapsible cards: tool name, title, status, input, output (pre). Reasoning collapsed. Each user message has "Revert to here" button (POST revert). When session.revert set, show banner with "Restore" (unrevert).
- Composer: textarea (Enter send, Shift+Enter newline), mode toggle Build/Plan (agent), model picker per session (select grouped by provider from /config/providers; remember per session in localStorage; default opencode/mimo-v2.6-flash-free), Stop button while busy.
- Permission requests: inline card in chat with Allow once / Always allow / Deny.
- Right panel tabs: Files (lazy tree from /file, click opens a Monaco editor tab in the center), Changes (session.diff + /file/status; unified diff viewer using `diff` package createTwoFilesPatch, colored lines), Search (grep via /find), Diagnostics (/lsp status).
- Bottom: toggleable Terminal panel with xterm.js (node_modules/@xterm/xterm) connected to engine pty websocket.
- Settings modal: tabs Providers (OpenRouter, OpenAI, Anthropic, Google Gemini, Groq, xAI: password input, Save, Remove, "Stored in OS keychain" state; OpenRouter "Sign in with OpenRouter" button performing PKCE OAuth: open https://openrouter.ai/auth?callback_url=http://127.0.0.1:<port>/callback&code_challenge=..&code_challenge_method=S256 in browser, local http listener receives ?code, POST https://openrouter.ai/api/v1/auth/keys {code,code_verifier,code_challenge_method:"S256"} -> {key}, store it), Custom endpoints (name, base URL, API key optional, model ids comma separated; Ollama + LM Studio presets), Appearance (Light/Dark), Privacy text: "No Cordoval servers. No telemetry. Keys stay on this device."
- Templates (src/templates/index.js): array of {id,name,category,description,prompt,system}. Categories Web (React+Vite, Next.js, static site), Desktop (Electron, Tauri), Mobile (Android Kotlin Jetpack Compose, React Native Expo, Flutter), Backend (Node API, Python FastAPI). Scaffold: create folder parent/name, open it as project, create session, send prompt_async with agent "build" and system = template.system + general builder system prompt (src/templates/system.js: plan first, create full project structure, run install/build/test commands, fix errors, summarise).
