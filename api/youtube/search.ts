import type {IncomingMessage, ServerResponse} from 'http';
import {getSearchParams, sendJson} from '../../lib/vercelHttp.js';
import {searchYouTube} from '../../lib/youtubeApi.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const params = getSearchParams(req);
  const q = String(params.get('q') || '').trim();
  const filter = String(params.get('filter') || 'all') as 'all' | 'videos' | 'channels' | 'playlists';
  if (!q) {
    sendJson(res, 400, {error: 'Missing search query'});
    return;
  }

  try {
    const result = await searchYouTube(q, filter);
    sendJson(res, 200, result, 'public, s-maxage=600, stale-while-revalidate=1800');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Search failed';
    sendJson(res, 502, {error: msg});
  }
}
