const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  /** When no allowlist is set, mirror the browser `Origin` so Vercel / preview URLs work. Empty allowlist + default localhost-only breaks production (CORS → invoke fails). */
  const allowOrigin =
    configuredOrigins.length > 0
      ? configuredOrigins.includes(origin)
        ? origin
        : (configuredOrigins[0] ?? '')
      : origin || defaultDevOrigins[0] || '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': configuredOrigins[0] ?? defaultDevOrigins[0],
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
