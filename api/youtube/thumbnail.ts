import type {IncomingMessage, ServerResponse} from 'http';
import {getSearchParams, sendJson} from '../../lib/vercelHttp.js';
import {getThumbnailBinary, isValidVideoId} from '../../lib/youtubeApi.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const params = getSearchParams(req);
  const videoId = String(params.get('videoId') || '').trim();
  if (!isValidVideoId(videoId)) {
    sendJson(res, 400, {error: 'Invalid YouTube video ID'});
    return;
  }

  const thumb = await getThumbnailBinary(videoId);
  if (!thumb) {
    sendJson(res, 404, {error: 'Thumbnail unavailable'});
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', thumb.contentType);
  res.setHeader('Cache-Control', 'public, s-maxage=2592000, max-age=2592000');
  res.end(thumb.buffer);
}
