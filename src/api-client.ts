import { config } from './config.js';

interface Envelope<T = unknown> {
  data: T;
  meta?: { timestamp?: string };
}

export class ChatBullqClient {
  constructor(private apiKey: string, private baseUrl = config.baseUrl) {}

  private headers() {
    return { Authorization: this.apiKey, 'Content-Type': 'application/json' };
  }

  async get<T = any>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), { headers: this.headers() });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${text || res.statusText}`);
    }
    const json = (await res.json()) as Envelope<T>;
    return (json && typeof json === 'object' && 'data' in json ? json.data : (json as T));
  }
}

// ─── Helpers (formatters reusable across tools) ───────────────

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR');
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const min = seconds / 60;
  if (min < 60) return `${min.toFixed(1)} min`;
  const h = min / 60;
  return `${h.toFixed(1)}h`;
}

export function formatDelta(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}
