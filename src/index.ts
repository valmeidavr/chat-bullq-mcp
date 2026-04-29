import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { ChatBullqClient } from './api-client.js';
import { config } from './config.js';
import { registerMeTools } from './tools/me.js';
import { registerDashboardTools } from './tools/dashboard.js';

function createServer(apiKey: string): McpServer {
  const server = new McpServer({ name: 'chat-bullq', version: '0.0.1' });
  const api = new ChatBullqClient(apiKey);
  registerMeTools(server, api);
  registerDashboardTools(server, api);
  return server;
}

function extractApiKey(req: express.Request): string | null {
  const header = req.headers.authorization?.trim();
  if (!header) return null;
  const token = (header.startsWith('Bearer ') ? header.slice(7) : header).trim();
  if (!token || !token.startsWith('pk_')) return null;
  return token;
}

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${config.baseUrl}/api/v1/public/me`, {
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function requireAuth(req: express.Request, res: express.Response): Promise<string | null> {
  const key = extractApiKey(req);
  if (!key) {
    res.status(401).json({
      error: 'Missing or invalid token. Use: Authorization: Bearer pk_YOUR_CHAT_BULLQ_API_KEY',
    });
    return null;
  }

  const valid = await validateApiKey(key);
  if (!valid) {
    res.status(403).json({ error: 'Invalid or revoked API key.' });
    return null;
  }

  return key;
}

// --- Stdio mode (local, env var) ---

async function runStdio(): Promise<void> {
  const apiKey = config.apiKey;
  if (!apiKey) {
    console.error('CHAT_BULLQ_API_KEY env var required for stdio mode');
    process.exit(1);
  }
  const server = createServer(apiKey);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Chat BullQ MCP Server running on stdio');
}

// --- HTTP mode (remote — each user sends pk_* token as Bearer) ---

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'chat-bullq-mcp', version: '0.0.1' });
  });

  // --- Streamable HTTP transport ---

  const streamableTransports = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer }
  >();

  app.all('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && streamableTransports.has(sessionId)) {
      const { transport } = streamableTransports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.method === 'POST') {
      const apiKey = await requireAuth(req, res);
      if (!apiKey) return;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createServer(apiKey);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) streamableTransports.delete(sid);
        server.close().catch(() => {});
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      const sid = transport.sessionId;
      if (sid) {
        streamableTransports.set(sid, { transport, server });
      }
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      res.status(400).json({ error: 'No active session. Send a POST to initialize.' });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  });

  // --- SSE transport (legacy fallback) ---

  const sseTransports = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

  app.get('/sse', async (req, res) => {
    const apiKey = await requireAuth(req, res);
    if (!apiKey) return;

    const transport = new SSEServerTransport('/messages', res);
    const server = createServer(apiKey);

    transport.onclose = () => {
      sseTransports.delete(transport.sessionId);
      server.close().catch(() => {});
    };

    await server.connect(transport);
    sseTransports.set(transport.sessionId, { transport, server });
    await transport.start();
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const entry = sseTransports.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await entry.transport.handlePostMessage(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || '3110', 10);
  app.listen(port, '0.0.0.0', () => {
    console.error(`Chat BullQ MCP Server v0.0.1 running on http://0.0.0.0:${port}`);
    console.error(`  Streamable HTTP: POST ${port}/mcp`);
    console.error(`  SSE (legacy):    GET  ${port}/sse`);
    console.error(`  Health:          GET  ${port}/health`);
    console.error('  Auth: Bearer pk_YOUR_CHAT_BULLQ_API_KEY (per-user)');
  });
}

// --- Entrypoint ---

const mode = process.argv.includes('--stdio') ? 'stdio' : 'http';

if (mode === 'stdio') {
  runStdio().catch(console.error);
} else {
  runHttp().catch(console.error);
}
