import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ChatBullqClient, formatNumber, formatPercent, formatDuration, formatDelta } from '../api-client.js';

const RangeShape = {
  from: z.string().optional().describe('Start date (ISO 8601 or YYYY-MM-DD). Default: 30 days ago'),
  to: z.string().optional().describe('End date (ISO 8601 or YYYY-MM-DD). Default: now'),
};

function rangeParams(args: { from?: string; to?: string }) {
  const params: Record<string, string> = {};
  if (args.from) params.from = args.from;
  if (args.to) params.to = args.to;
  return params;
}

export function registerDashboardTools(server: McpServer, api: ChatBullqClient) {
  server.tool(
    'chat_dashboard_overview',
    'Hero KPIs: active conversations (with breakdown), TMR, SLA compliance, resolution rate, totals + trends vs previous period.',
    RangeShape,
    async (args) => {
      try {
        const d = (await api.get('/api/v1/public/dashboard/overview', rangeParams(args))) as any;
        const text = [
          '# Overview',
          '',
          `Conversas ativas:    ${formatNumber(d.activeConversations)}`,
          `  - Pendentes:       ${formatNumber(d.activeBreakdown?.pending)}`,
          `  - Abertas:         ${formatNumber(d.activeBreakdown?.open)}`,
          `  - Aguardando:      ${formatNumber(d.activeBreakdown?.waiting)}`,
          `  - Bot:             ${formatNumber(d.activeBreakdown?.bot)}`,
          '',
          `TMR (1ª resposta):   ${formatDuration((d.avgFirstResponseMinutes ?? 0) * 60)}  (${formatDelta(d.avgFirstResponseTrend)} vs período anterior)`,
          `SLA cumprido:        ${formatPercent(d.slaCompliancePercent)}  (${formatDelta(d.slaTrend)} vs período anterior)`,
          `Taxa de resolução:   ${formatPercent(d.resolutionRatePercent)}  (${formatDelta(d.resolutionTrend)} vs período anterior)`,
          `TM resolução:        ${formatDuration((d.avgResolutionMinutes ?? 0) * 60)}`,
          '',
          `Total conversas:     ${formatNumber(d.totalConversations)}  (${formatDelta(d.conversationsTrend)})`,
          `Total mensagens:     ${formatNumber(d.totalMessages)}  (${formatDelta(d.messagesTrend)})`,
        ];
        return { content: [{ type: 'text', text: text.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_volume_by_day',
    'Conversation volume per day (count of conversations created).',
    RangeShape,
    async (args) => {
      try {
        const data = (await api.get('/api/v1/public/dashboard/volume-by-day', rangeParams(args))) as any[];
        if (!data.length) return { content: [{ type: 'text', text: 'Sem volume no período.' }] };
        const lines = data.map((r) => `${r.date}: ${formatNumber(r.count)}`);
        const total = data.reduce((s, r) => s + (r.count || 0), 0);
        return { content: [{ type: 'text', text: `Volume diário (total ${formatNumber(total)}):\n\n${lines.join('\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_volume_by_channel',
    'Conversation volume grouped by channel (WhatsApp, Instagram, etc.).',
    RangeShape,
    async (args) => {
      try {
        const data = (await api.get('/api/v1/public/dashboard/volume-by-channel', rangeParams(args))) as any[];
        if (!data.length) return { content: [{ type: 'text', text: 'Nenhum canal com volume no período.' }] };
        const total = data.reduce((s, r) => s + (r.count || 0), 0);
        const lines = data
          .sort((a, b) => b.count - a.count)
          .map((r) => {
            const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : '0.0';
            return `${r.channelName} [${r.channelType ?? '—'}]: ${formatNumber(r.count)}  (${pct}%)`;
          });
        return { content: [{ type: 'text', text: `Volume por canal (total ${formatNumber(total)}):\n\n${lines.join('\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_volume_by_status',
    'Snapshot of conversations grouped by current status (PENDING, BOT, OPEN, WAITING, CLOSED).',
    {},
    async () => {
      try {
        const data = (await api.get('/api/v1/public/dashboard/volume-by-status')) as any[];
        if (!data.length) return { content: [{ type: 'text', text: 'Nenhuma conversa no workspace.' }] };
        const total = data.reduce((s, r) => s + (r.count || 0), 0);
        const lines = data
          .sort((a, b) => b.count - a.count)
          .map((r) => {
            const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : '0.0';
            return `${r.status}: ${formatNumber(r.count)}  (${pct}%)`;
          });
        return { content: [{ type: 'text', text: `Status atual (total ${formatNumber(total)}):\n\n${lines.join('\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_kpi_sparklines',
    'Daily series for hero KPIs: active conversations, first response time, SLA %, resolution %.',
    RangeShape,
    async (args) => {
      try {
        const d = (await api.get('/api/v1/public/dashboard/kpi-sparklines', rangeParams(args))) as any;
        const summarize = (label: string, points: { date: string; value: number }[], suffix: string) => {
          if (!points?.length) return `${label}: —`;
          const last = points[points.length - 1];
          const first = points[0];
          const max = Math.max(...points.map((p) => p.value));
          return `${label}: ${first.value}${suffix} → ${last.value}${suffix}   (pico ${max}${suffix}, ${points.length} dias)`;
        };
        const text = [
          '# KPI Sparklines (séries diárias)',
          '',
          summarize('Conversas ativas', d.active, ''),
          summarize('TMR (min)       ', d.firstResponse, ' min'),
          summarize('SLA cumprido    ', d.sla, '%'),
          summarize('Resolução       ', d.resolution, '%'),
        ];
        return { content: [{ type: 'text', text: text.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_agent_performance',
    'Per-agent performance: total/closed conversations, current load, resolution rate, avg first response, avg resolution time.',
    RangeShape,
    async (args) => {
      try {
        const data = (await api.get('/api/v1/public/dashboard/agent-performance', rangeParams(args))) as any[];
        if (!data.length) return { content: [{ type: 'text', text: 'Sem performance no período.' }] };
        const lines = data
          .sort((a, b) => b.totalConversations - a.totalConversations)
          .map((a) => {
            return [
              `• ${a.agent?.name ?? '—'}`,
              `    Atendidas: ${formatNumber(a.totalConversations)} | Fechadas: ${formatNumber(a.closedConversations)} | Em curso: ${formatNumber(a.activeConversations)}`,
              `    Resolução: ${formatPercent(a.resolutionRate)} | TMR: ${formatDuration((a.avgFirstResponseMinutes ?? 0) * 60)} | TM Resolução: ${formatDuration((a.avgResolutionMinutes ?? 0) * 60)}`,
            ].join('\n');
          });
        return { content: [{ type: 'text', text: `Performance por agente:\n\n${lines.join('\n\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_volume_flow',
    'Created vs closed conversations per day (flow into and out of the queue).',
    RangeShape,
    async (args) => {
      try {
        const data = (await api.get('/api/v1/public/dashboard/volume-flow', rangeParams(args))) as any[];
        if (!data.length) return { content: [{ type: 'text', text: 'Sem fluxo no período.' }] };
        const lines = data.map((r) => `${r.date}:  +${formatNumber(r.created).padStart(5)}  /  -${formatNumber(r.closed).padStart(5)}   (saldo ${r.created - r.closed >= 0 ? '+' : ''}${r.created - r.closed})`);
        const totalCreated = data.reduce((s, r) => s + (r.created || 0), 0);
        const totalClosed = data.reduce((s, r) => s + (r.closed || 0), 0);
        return {
          content: [
            {
              type: 'text',
              text: `Fluxo (criadas / fechadas):\n\n${lines.join('\n')}\n\nTotal: criadas ${formatNumber(totalCreated)} | fechadas ${formatNumber(totalClosed)} | saldo ${totalCreated - totalClosed >= 0 ? '+' : ''}${totalCreated - totalClosed}`,
            },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_peak_hours',
    'Heatmap of conversation creation: 7 (day of week) × 24 (hour) matrix. Returns the busiest day/hour.',
    RangeShape,
    async (args) => {
      try {
        const d = (await api.get('/api/v1/public/dashboard/peak-hours', rangeParams(args))) as any;
        const matrix = d.matrix as number[][];
        const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

        let peakDay = 0, peakHour = 0, peakValue = 0;
        for (let day = 0; day < 7; day++) {
          for (let h = 0; h < 24; h++) {
            if (matrix[day][h] > peakValue) {
              peakValue = matrix[day][h];
              peakDay = day;
              peakHour = h;
            }
          }
        }

        const dayTotals = matrix.map((row, i) => ({
          day: dayNames[i],
          total: row.reduce((s, v) => s + v, 0),
        }));

        const hourTotals = Array.from({ length: 24 }, (_, h) => ({
          hour: h,
          total: matrix.reduce((s, row) => s + row[h], 0),
        }));

        const top3Hours = [...hourTotals].sort((a, b) => b.total - a.total).slice(0, 3);

        const text = [
          `Pico absoluto: ${dayNames[peakDay]} ${String(peakHour).padStart(2, '0')}h  (${formatNumber(peakValue)} conversas, máximo da matriz: ${formatNumber(d.max)})`,
          '',
          'Total por dia da semana:',
          ...dayTotals.map((dt) => `  ${dt.day}: ${formatNumber(dt.total)}`),
          '',
          'Top 3 horas (somando a semana toda):',
          ...top3Hours.map((h, i) => `  ${i + 1}. ${String(h.hour).padStart(2, '0')}h — ${formatNumber(h.total)}`),
        ];
        return { content: [{ type: 'text', text: text.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_messages_flow',
    'Inbound vs outbound messages per day.',
    RangeShape,
    async (args) => {
      try {
        const data = (await api.get('/api/v1/public/dashboard/messages-flow', rangeParams(args))) as any[];
        if (!data.length) return { content: [{ type: 'text', text: 'Sem mensagens no período.' }] };
        const totalIn = data.reduce((s, r) => s + (r.inbound || 0), 0);
        const totalOut = data.reduce((s, r) => s + (r.outbound || 0), 0);
        const lines = data.map((r) => `${r.date}:  ↓${formatNumber(r.inbound).padStart(5)}  /  ↑${formatNumber(r.outbound).padStart(5)}`);
        return {
          content: [
            {
              type: 'text',
              text: `Mensagens (recebidas / enviadas):\n\n${lines.join('\n')}\n\nTotal: ↓${formatNumber(totalIn)}  ↑${formatNumber(totalOut)}`,
            },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_bot_performance',
    'Bot resolution vs human escalation breakdown for the period.',
    RangeShape,
    async (args) => {
      try {
        const d = (await api.get('/api/v1/public/dashboard/bot-performance', rangeParams(args))) as any;
        const text = [
          'Bot vs humano:',
          `  Resolvidas pelo bot: ${formatNumber(d.botResolved)}`,
          `  Escaladas p/ humano: ${formatNumber(d.humanHandled)}`,
          `  Em andamento:        ${formatNumber(d.inFlight)}`,
          `  Total no período:    ${formatNumber(d.total)}`,
          '',
          `Taxa de resolução do bot: ${formatPercent(d.botResolutionRate)}`,
          `Taxa de escalação:        ${formatPercent(d.escalationRate)}`,
        ];
        return { content: [{ type: 'text', text: text.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );

  server.tool(
    'chat_dashboard_top_tags',
    'Top tags used in conversations (proxy for top reasons).',
    {
      ...RangeShape,
      limit: z.number().int().min(1).max(50).optional().default(5).describe('Max tags to return (default 5)'),
    },
    async (args) => {
      try {
        const params: Record<string, string> = { ...rangeParams(args) };
        if (args.limit !== undefined) params.limit = String(args.limit);
        const data = (await api.get('/api/v1/public/dashboard/top-tags', params)) as any[];
        if (!data.length) return { content: [{ type: 'text', text: 'Nenhuma tag encontrada no período.' }] };
        const lines = data.map((t, i) => `${i + 1}. ${t.name}  —  ${formatNumber(t.count)} conversas`);
        return { content: [{ type: 'text', text: `Top tags:\n\n${lines.join('\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
      }
    },
  );
}
