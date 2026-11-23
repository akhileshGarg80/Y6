import type {IncomingMessage, ServerResponse} from 'http';

export function getSearchParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url || '/', 'http://localhost');
  return url.searchParams;
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown, cacheControl?: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheControl) {
    res.setHeader('Cache-Control', cacheControl);
  }
  res.end(JSON.stringify(payload));
}
