import type {IncomingMessage, ServerResponse} from 'http';
import {getSearchParams, sendJson} from '../../lib/vercelHttp.js';
import {getPlaylistVideos, isValidListId} from '../../lib/youtubeApi.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const params = getSearchParams(req);
  const listId = String(params.get('list') || '').trim();
  const seedVideoId = String(params.get('v') || '').trim();
  if (!isValidListId(listId)) {
    sendJson(res, 400, {error: 'Invalid playlist ID'});
    return;
  }

  try {
    const result = await getPlaylistVideos(listId, seedVideoId);
    if (result.videos.length === 0) {
      sendJson(res, 404, {error: 'No videos found for this playlist'});
      return;
    }
    sendJson(res, 200, result, 'public, s-maxage=900, stale-while-revalidate=3600');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Playlist lookup failed';
    sendJson(res, 502, {error: msg});
  }
}
