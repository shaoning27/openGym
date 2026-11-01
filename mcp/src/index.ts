#!/usr/bin/env node
// Legacy dynamic types are explicit during the full language migration.
/* openGym MCP server — stdio transport. The LLM client (Claude Desktop, Cursor, …) spawns
   this process locally, talks JSON-RPC over stdin/stdout, tears it down when the session ends.
   No extra container. The read tools make no network call; log_workout, once paired, talks to
   your own openGym server and nothing else — your data stays in a folder you control. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.ts';
import { WRITE_TOOLS } from './write-tools.ts';
import { init, getUser } from './state.ts';
const server: any = new McpServer({
    name: 'opengym',
    version: '0.1.0'
});
// Fail fast on bad config so a misnamed OPENGYM_DATA doesn't silently answer every call with
// the no-state sentinel. Always register every tool so the LLM sees the full list at
// handshake, even when state didn't resolve.
try {
    init();
    const u: any = getUser();
    console.error(`[opengym-mcp] serving profile ${u.name} (${u.id})`);
}
catch (e: any) {
    console.error(`[opengym-mcp] ${e.message}`);
    // Don't exit — keep the tool listings up so the user sees a useful error after fixing their
    // env and restarting.
}
for (const t of [...TOOLS, ...WRITE_TOOLS]) {
    server.tool(t.name, t.description, t.schema, async (params?: any) => {
        try {
            // log_workout talks to the server, so a handler may answer with a promise.
            const result: any = await t.handler(params || {});
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err: any) {
            const code: any = err.code || 'ERROR';
            return {
                isError: true,
                content: [{ type: 'text', text: `${code}: ${err.message}` }]
            };
        }
    });
}
const transport: any = new StdioServerTransport();
await server.connect(transport);
// Process stays alive serving JSON-RPC over stdio until the LLM client disconnects.
