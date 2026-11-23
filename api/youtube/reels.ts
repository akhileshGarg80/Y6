import type {IncomingMessage, ServerResponse} from 'http';
import {getSearchParams, sendJson} from '../../lib/vercelHttp.js';
import {getReelsFeed} from '../../lib/youtubeApi.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const params = getSearchParams(req);
  const topic = String(params.get('topic') || 'all').trim();
  const page = Math.max(0, Number.parseInt(String(params.get('page') || '0'), 10) || 0);

  try {
    const result = await getReelsFeed(topic, page);
    sendJson(res, 200, result, 'public, s-maxage=300, stale-while-revalidate=900');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not fetch reels feed';
    sendJson(res, 502, {error: msg});
  }
}
