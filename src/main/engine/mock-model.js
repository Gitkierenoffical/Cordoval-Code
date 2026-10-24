'use strict';
// Deterministic scripted model for headless tests (enabled only with CORDOVAL_MOCK_PROVIDER=1).
// It reads the latest user request and answers with fixed text or a single tool call.

function lastUserText(prompt) {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i];
    if (m.role === 'user') return (m.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
  }
  return '';
}
function decide(prompt, system) {
  const last = prompt[prompt.length - 1];
  const text = lastUserText(prompt);
  const all = (system || '') + '\n' + text;
  if (last && last.role === 'tool') {
    const out = (last.content || []).map(c => c.output && (c.output.value || '')).join(' ');
    const failed = (last.content || []).some(c => c.output && /error/.test(c.output.type));
    return { text: failed ? 'DONE. The action was not allowed: ' + String(out).slice(0, 120) : 'DONE. The tool finished.' };
  }
  let m;
  if (/summari[sz]e the conversation/i.test(all)) return { text: 'Summary: the user and assistant worked on files in this project.' };
  if (/AGENTS\.md/.test(text) && /create|analy[sz]e/i.test(text)) return { tool: 'write', input: { filePath: 'AGENTS.md', content: '# Agent notes\n\nThis project was analysed by Cordoval Code.\n' } };
  if ((m = text.match(/Run exactly this shell command[^:]*:\s*(.+)$/im))) return { tool: 'bash', input: { command: m[1].trim(), description: 'Run the requested command' } };
  if ((m = text.match(/^- (\S+) line \d+[^:]*: `([^`]*)`\s*\n\s*This should add, not subtract/m))) return { tool: 'edit', input: { filePath: m[1], oldString: m[2].trim(), newString: m[2].trim().replace(' - ', ' + ') } };
  if ((m = text.match(/(?:create|write) a file (?:named|called) (\S+?)\s+containing (?:the word |the text )?["']?([^"'.\n]+?)["']?(?:\.|\s+using|\s+Use|$)/i))) return { tool: 'write', input: { filePath: m[1], content: m[2].trim() + '\n' } };
  if ((m = text.match(/Fetch the page (\S+)/i))) return { tool: 'webfetch', input: { url: m[1], format: 'markdown' } };
  if ((m = text.match(/Research with a subagent: (.+)$/im))) return { tool: 'task', input: { description: 'Research the project', prompt: m[1].trim() } };
  if (/^List the project files/i.test(text)) return { tool: 'list', input: { path: '.' } };
  if (/essay/i.test(text)) return { slow: true };
  if ((m = all.match(/code word is (\w+)/i))) return { text: m[1] };
  if (/attached image/i.test(text)) return { text: 'Red' };
  if ((m = text.match(/Reply with (?:exactly |only )?(?:the )?(?:single )?word (\w+)(.*)$/im))) return { text: /capital/i.test(m[2]) ? m[1].toUpperCase() : m[1] };
  if (/^Plan only/i.test(text)) return { text: 'Plan: 1. Create README.md with a title. 2. Describe how to run the project.' };
  return { text: 'OK. ' + text.slice(0, 80) };
}

function usage() { return { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } }; }

function create(modelId) {
  return {
    specificationVersion: 'v3', provider: 'mock', modelId, supportedUrls: {},
    async doGenerate() { throw new Error('not used'); },
    async doStream(options) {
      const sys = (options.prompt.find(p => p.role === 'system') || {}).content || '';
      const plan = decide(options.prompt.filter(p => p.role !== 'system'), sys);
      const signal = options.abortSignal;
      const stream = new ReadableStream({
        async start(ctrl) {
          ctrl.enqueue({ type: 'stream-start', warnings: [] });
          if (plan.tool) {
            const callId = 'call_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            ctrl.enqueue({ type: 'tool-input-start', id: callId, toolName: plan.tool });
            ctrl.enqueue({ type: 'tool-input-end', id: callId });
            ctrl.enqueue({ type: 'tool-call', toolCallId: callId, toolName: plan.tool, input: JSON.stringify(plan.input) });
            ctrl.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: usage() });
            ctrl.close();
            return;
          }
          ctrl.enqueue({ type: 'text-start', id: 't1' });
          if (plan.slow) {
            for (let i = 0; i < 600; i++) {
              if (signal && signal.aborted) { ctrl.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
              ctrl.enqueue({ type: 'text-delta', id: 't1', delta: 'Compilers ' + i + '. ' });
              await new Promise(r => setTimeout(r, 100));
            }
          } else {
            for (const chunk of plan.text.match(/.{1,12}/gs) || ['']) { ctrl.enqueue({ type: 'text-delta', id: 't1', delta: chunk }); await new Promise(r => setTimeout(r, 15)); }
          }
          ctrl.enqueue({ type: 'text-end', id: 't1' });
          ctrl.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: usage() });
          ctrl.close();
        },
      });
      return { stream };
    },
  };
}
module.exports = { create, decide };
