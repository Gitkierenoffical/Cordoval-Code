// Tiny stdio MCP server used by the customize test. One tool: say.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const server = new McpServer({ name: 'echo', version: '1.0.0' });
server.registerTool('say', { description: 'Echo the text back', inputSchema: {} }, async (args) => ({ content: [{ type: 'text', text: 'echo: ' + JSON.stringify(args || {}) }] }));
server.connect(new StdioServerTransport());
