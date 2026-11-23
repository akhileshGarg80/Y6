import type {IncomingMessage, ServerResponse} from 'http';
import {getSearchParams, sendJson} from '../../lib/vercelHttp.js';
import {getRelatedVideos, isValidVideoId} from '../../lib/youtubeApi.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const params = getSearchParams(req);
  const videoId = String(params.get('videoId') || '').trim();
  if (!isValidVideoId(videoId)) {
    sendJson(res, 400, {error: 'Invalid YouTube video ID'});
    return;
  }

  try {
    const related = await getRelatedVideos(videoId);
    sendJson(res, 200, {videoId, related}, 'public, s-maxage=900, stale-while-revalidate=3600');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not fetch suggested videos';
    sendJson(res, 502, {error: msg});
  }
}
