import type {IncomingMessage, ServerResponse} from 'http';
import {getSearchParams, sendJson} from '../../lib/vercelHttp.js';
import {getVideoMetadata, isValidVideoId} from '../../lib/youtubeApi.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const params = getSearchParams(req);
  const videoId = String(params.get('videoId') || '').trim();
  if (!isValidVideoId(videoId)) {
    sendJson(res, 400, {error: 'Invalid YouTube video ID'});
    return;
  }

  try {
    const result = await getVideoMetadata(videoId);
    sendJson(res, 200, result, 'public, s-maxage=3600, stale-while-revalidate=86400');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Metadata lookup failed';
    sendJson(res, 502, {error: msg});
  }
}
