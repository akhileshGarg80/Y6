import type {IncomingMessage, ServerResponse} from 'http';
import {getSearchParams, sendJson} from '../../lib/vercelHttp.js';
import {getChannelVideos} from '../../lib/youtubeApi.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const params = getSearchParams(req);
  const rawHandle = String(params.get('handle') || '').trim();
  if (!rawHandle) {
    sendJson(res, 400, {error: 'Missing channel name or @username'});
    return;
  }

  try {
    const result = await getChannelVideos(rawHandle);
    if (!result) {
      sendJson(res, 404, {error: 'No YouTube channel found matching that name'});
      return;
    }
    sendJson(res, 200, result, 'public, s-maxage=900, stale-while-revalidate=3600');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Channel lookup failed';
    sendJson(res, 502, {error: msg});
  }
}
