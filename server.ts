import express from 'express';
import path from 'path';
import {fileURLToPath} from 'url';
import {
  getChannelVideos,
  getPlaylistVideos,
  getRelatedVideos,
  getThumbnailBinary,
  getVideoMetadata,
  isValidListId,
  isValidVideoId,
  searchYouTube,
} from './lib/youtubeApi.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({limit: '2mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true, timestamp: Date.now()});
  });

  app.get('/api/youtube/metadata', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    if (!isValidVideoId(videoId)) {
      res.status(400).json({error: 'Invalid YouTube video ID'});
      return;
    }

    const result = await getVideoMetadata(videoId);
    res.json(result);
  });

  app.get('/api/youtube/playlist', async (req, res) => {
    const listId = String(req.query.list || '').trim();
    const seedVideoId = String(req.query.v || '').trim();
    if (!isValidListId(listId)) {
      res.status(400).json({error: 'Invalid playlist ID'});
      return;
    }

    const result = await getPlaylistVideos(listId, seedVideoId);
    if (result.videos.length === 0) {
      res.status(404).json({error: 'No videos found for this playlist'});
      return;
    }

    res.json(result);
  });

  app.get('/api/youtube/channel', async (req, res) => {
    const rawHandle = String(req.query.handle || '').trim();
    if (!rawHandle) {
      res.status(400).json({error: 'Missing channel name or @username'});
      return;
    }

    try {
      const result = await getChannelVideos(rawHandle);
      if (!result) {
        res.status(404).json({error: 'No YouTube channel found matching that name'});
        return;
      }
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Channel lookup failed';
      res.status(502).json({error: msg});
    }
  });

  app.get('/api/youtube/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const filter = String(req.query.filter || 'all') as 'all' | 'videos' | 'channels' | 'playlists';
    if (!q) {
      res.status(400).json({error: 'Missing search query'});
      return;
    }

    try {
      const result = await searchYouTube(q, filter);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Search failed';
      res.status(502).json({error: msg});
    }
  });

  app.get('/api/youtube/related', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    if (!isValidVideoId(videoId)) {
      res.status(400).json({error: 'Invalid YouTube video ID'});
      return;
    }

    try {
      const related = await getRelatedVideos(videoId);
      res.json({videoId, related});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not fetch suggested videos';
      res.status(502).json({error: msg});
    }
  });

  app.get('/api/youtube/thumbnail', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    if (!isValidVideoId(videoId)) {
      res.status(400).json({error: 'Invalid YouTube video ID'});
      return;
    }

    const thumb = await getThumbnailBinary(videoId);
    if (!thumb) {
      res.status(404).json({error: 'Thumbnail unavailable'});
      return;
    }

    res.setHeader('Content-Type', thumb.contentType);
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.send(thumb.buffer);
  });

  if (!isProduction) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TubeVault server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
