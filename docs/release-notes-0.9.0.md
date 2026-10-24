# Cordoval Code 0.9.0

The first public release of Cordoval Code, an open-source AI coding desktop app for Windows and Linux. MIT licensed.

## Highlights

- **Own engine.** Chat, file edits, terminal commands and undo run inside the app on a local-only API (`127.0.0.1`, random port, per-run token).
- **Bring your own key.** OpenRouter (key or Sign in with OpenRouter), OpenAI, Anthropic, Google Gemini, Groq, xAI and any OpenAI-compatible endpoint, with Ollama and LM Studio presets. Keys are encrypted with Electron safeStorage and sent only to the provider's own host.
- **Approvals.** Shell commands, web fetches and outside-project writes ask first: Allow once, Always allow or Deny. Risky commands (sudo, rm -rf, git push, npm publish, curl | sh) always ask, with a risk note. Review and revoke rules in Settings > Permissions.
- **Web fetch** turns a public page into markdown or text and asks per site. No keys or cookies are sent, and private networks are blocked.
- **Cost counter** on every reply. Unknown prices show as "unknown", never $0.
- **Research subagent** (`task` tool) with read-only tools.
- **Undo** via snapshots, with diffs and revert to any message.

## Also in this release

Monaco editor, Changes view with per-line review comments, terminal panel, MCP servers, custom agents and commands, Build and Plan modes, @-mentions, attachments, command palette, project tabs, rebindable shortcuts, 37 themes, session search and export, and project templates.

## Getting started

    git clone https://github.com/Gitkierenoffical/Cordoval-Code.git
    cd Cordoval-Code
    npm install
    npm start

There is no installer yet; run from source. Requires Node.js 20 and Git.

## Known limitations

- No signed installers yet.
- Windows and Linux only.
- Cost figures for direct providers use a small built-in price table and may lag provider price changes.

Feedback and issues: https://github.com/Gitkierenoffical/Cordoval-Code/issues  
Website: https://code.cordoval.co.uk  
Contact: management@cordoval.co.uk
