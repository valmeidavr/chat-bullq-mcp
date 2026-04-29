import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ChatBullqClient } from '../api-client.js';

export function registerMeTools(server: McpServer, api: ChatBullqClient) {
  server.tool(
    'chat_me',
    'Identifies the API key holder (user + organization). Useful as a sanity check.',
    {},
    async () => {
      try {
        const data = (await api.get('/api/v1/public/me')) as any;
        const lines = [
          `User:  ${data.user?.name ?? '—'} <${data.user?.email ?? '—'}> (id: ${data.user?.id})`,
          `Org:   ${data.organization?.name ?? '—'} (slug: ${data.organization?.slug ?? '—'}, id: ${data.organization?.id})`,
          `Role:  ${data.organization?.userRole ?? '—'}`,
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );
}
