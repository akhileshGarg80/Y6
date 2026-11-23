const YT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface ExtractedVideo {
  videoId: string;
  title: string;
  authorName: string;
  authorUrl: string;
  durationText: string;
  durationSeconds: number | null;
  viewText: string;
  watchUrl: string;
}

export interface ExtractedChannel {
  channelId: string;
  title: string;
  handle: string;
  subscriberText: string;
}

export interface ExtractedPlaylist {
  listId: string;
  title: string;
  authorName: string;
  videoCountText: string;
  playlistUrl: string;
}

export function isValidVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

export function isValidListId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{4,80}$/.test(id);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function parseDurationText(text: string): number | null {
  const clean = text.trim();
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(clean)) return null;
  const parts = clean.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const obj = node as {simpleText?: string; content?: string; runs?: Array<{text?: string}>};
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.runs)) {
    return obj.runs.map((r) => r.text || '').join('');
  }
  return '';
}

function extractYtInitialData(html: string): Record<string, unknown> | null {
  const match = html.match(/var ytInitialData = (\{.+?\});<\/script>/);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectByKey(root: unknown, targetKey: string, acc: unknown[] = []): unknown[] {
  if (!root || typeof root !== 'object') return acc;
  if (Array.isArray(root)) {
    for (const item of root) collectByKey(item, targetKey, acc);
    return acc;
  }
  const obj = root as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === targetKey) {
      acc.push(v);
    } else {
      collectByKey(v, targetKey, acc);
    }
  }
  return acc;
}

function normalizeLockupVideo(lv: Record<string, unknown>, fallbackAuthor: string): ExtractedVideo | null {
  const videoId = String(lv.contentId || '');
  if (!isValidVideoId(videoId)) return null;

  const meta = (lv.metadata as Record<string, unknown> | undefined)?.lockupMetadataViewModel as
    | Record<string, unknown>
    | undefined;
  const title = extractText(meta?.title) || `YouTube Video (${videoId})`;

  const rows = ((meta?.metadata as Record<string, unknown> | undefined)?.contentMetadataViewModel as
    | {metadataRows?: Array<{metadataParts?: Array<{text?: {content?: string}}>}>}
    | undefined)?.metadataRows;
  const rowTexts: string[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      for (const part of row.metadataParts || []) {
        if (part.text?.content) rowTexts.push(part.text.content);
      }
    }
  }

  let durationText = '';
  const overlays = (lv.contentImage as {thumbnailViewModel?: {overlays?: Array<Record<string, unknown>>}} | undefined)
    ?.thumbnailViewModel?.overlays;
  if (Array.isArray(overlays)) {
    for (const ov of overlays) {
      const badges = (ov.thumbnailBottomOverlayViewModel as {badges?: Array<{thumbnailBadgeViewModel?: {text?: string}}>})?.badges;
      if (badges?.[0]?.thumbnailBadgeViewModel?.text) {
        durationText = badges[0].thumbnailBadgeViewModel.text;
        break;
      }
    }
  }

  const resolvedAuthor = fallbackAuthor || rowTexts[0] || 'YouTube Creator';
  const resolvedViews =
    !fallbackAuthor && rowTexts.length > 1 ? rowTexts.slice(1).join(' · ') : rowTexts.join(' · ');

  return {
    videoId,
    title,
    authorName: resolvedAuthor,
    authorUrl: '',
    durationText,
    durationSeconds: durationText ? parseDurationText(durationText) : null,
    viewText: resolvedViews,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function normalizeLegacyVideoRenderer(
  vr: Record<string, unknown>,
  fallbackAuthor = 'YouTube Creator'
): ExtractedVideo | null {
  const videoId = String(vr.videoId || '');
  if (!isValidVideoId(videoId)) return null;

  const title = extractText(vr.title) || `YouTube Video (${videoId})`;
  const authorName =
    extractText(vr.ownerText) ||
    extractText(vr.shortBylineText) ||
    extractText(vr.longBylineText) ||
    fallbackAuthor;

  const bylineRuns =
    ((vr.ownerText || vr.shortBylineText) as {
      runs?: Array<{navigationEndpoint?: {browseEndpoint?: {canonicalBaseUrl?: string}}}>;
    })?.runs || [];
  const baseUrl = bylineRuns[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
  const authorUrl = baseUrl ? `https://www.youtube.com${baseUrl}` : '';

  const durationText = extractText(vr.lengthText);
  const viewText = extractText(vr.shortViewCountText) || extractText(vr.viewCountText);

  return {
    videoId,
    title,
    authorName,
    authorUrl,
    durationText,
    durationSeconds: durationText ? parseDurationText(durationText) : null,
    viewText,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function fetchChannelVideosByPath(channelPath: string): Promise<{
  channelTitle: string;
  handle: string;
  videos: ExtractedVideo[];
}> {
  const normalizedPath = channelPath.startsWith('/') ? channelPath : `/${channelPath}`;
  const targetUrl = `https://www.youtube.com${normalizedPath.replace(/\/+$/, '')}/videos`;
  const resp = await fetch(targetUrl, {
    headers: YT_HEADERS,
    signal: AbortSignal.timeout(7500),
  });
  if (!resp.ok) {
    throw new Error(`Channel lookup returned ${resp.status}`);
  }
  const html = await resp.text();
  const data = extractYtInitialData(html);
  if (!data) {
    throw new Error('Could not parse YouTube channel data');
  }

  const headerMeta = (data.metadata as {channelMetadataRenderer?: {title?: string; vanityChannelUrl?: string}})
    ?.channelMetadataRenderer;
  const channelTitle = headerMeta?.title || normalizedPath.replace(/^\/+/, '');
  const handle = normalizedPath;

  const seen = new Set<string>();
  const videos: ExtractedVideo[] = [];

  for (const raw of collectByKey(data, 'lockupViewModel')) {
    const item = normalizeLockupVideo(raw as Record<string, unknown>, channelTitle);
    if (item && !seen.has(item.videoId)) {
      seen.add(item.videoId);
      videos.push(item);
    }
  }

  for (const key of ['gridVideoRenderer', 'videoRenderer']) {
    for (const raw of collectByKey(data, key)) {
      const item = normalizeLegacyVideoRenderer(raw as Record<string, unknown>, channelTitle);
      if (item && !seen.has(item.videoId)) {
        seen.add(item.videoId);
        videos.push(item);
      }
    }
  }

  return {channelTitle, handle, videos: videos.slice(0, 45)};
}

async function searchChannelsOnly(query: string): Promise<ExtractedChannel[]> {
  const resp = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%3D%3D`,
    {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(7500),
    }
  );
  if (!resp.ok) return [];
  const html = await resp.text();
  const data = extractYtInitialData(html);
  if (!data) return [];

  const channels: ExtractedChannel[] = [];
  const seen = new Set<string>();
  for (const raw of collectByKey(data, 'channelRenderer')) {
    const ch = raw as Record<string, unknown>;
    const channelId = String(ch.channelId || '');
    const title = extractText(ch.title);
    const nav = (ch.navigationEndpoint as {browseEndpoint?: {canonicalBaseUrl?: string}} | undefined)
      ?.browseEndpoint?.canonicalBaseUrl;
    const handle = nav || (channelId ? `/channel/${channelId}` : '');
    const subscriberText =
      extractText(ch.videoCountText) || extractText(ch.subscriberCountText);
    if (channelId && title && handle && !seen.has(channelId)) {
      seen.add(channelId);
      channels.push({channelId, title, handle, subscriberText});
    }
  }
  return channels.slice(0, 10);
}

export async function getVideoMetadata(videoId: string) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let title = `YouTube Video (${videoId})`;
  let authorName = 'YouTube Creator';
  let authorUrl = '';
  let description = '';
  let durationSeconds: number | null = null;
  let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const chapters: Array<{timeSeconds: number; label: string}> = [];

  try {
    const oembedResp = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      {
        headers: {'User-Agent': 'Mozilla/5.0 (compatible; TubeVault/1.0)'},
        signal: AbortSignal.timeout(6500),
      }
    );

    if (oembedResp.ok) {
      const data = (await oembedResp.json()) as {
        title?: string;
        author_name?: string;
        author_url?: string;
        thumbnail_url?: string;
      };
      if (data.title) title = data.title;
      if (data.author_name) authorName = data.author_name;
      if (data.author_url) authorUrl = data.author_url;
      if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
    }
  } catch {
    // Fall back to watch page scrape below
  }

  try {
    const pageResp = await fetch(watchUrl, {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(7000),
    });

    if (pageResp.ok) {
      const html = await pageResp.text();
      const descMatch = html.match(/<meta name="description" content="([^"]*)"/);
      if (descMatch && descMatch[1]) {
        description = decodeHtmlEntities(descMatch[1]);
      }
      const durMatch = html.match(/"lengthSeconds":"(\d+)"/);
      if (durMatch && durMatch[1]) {
        const parsed = Number(durMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
          durationSeconds = parsed;
        }
      }
      if (title.startsWith('YouTube Video (')) {
        const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/);
        if (titleMatch && titleMatch[1]) {
          title = decodeHtmlEntities(titleMatch[1]);
        }
      }
      const shortDescMatch = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
      if (shortDescMatch?.[1]) {
        try {
          const fullDesc = JSON.parse(`"${shortDescMatch[1]}"`) as string;
          if (fullDesc) description = fullDesc;
        } catch {
          // Keep meta description
        }
      }
    }
  } catch {
    // Optional enrichment failure is safe to ignore
  }

  if (description) {
    const seenTimes = new Set<number>();
    for (const line of description.split(/\r?\n/)) {
      const m = line.trim().match(/^(?:\[)?(\d{1,2}:)?(\d{1,2}):(\d{2})(?:\])?\s*[-–—:|]?\s*(.+)$/);
      if (m) {
        const hrs = m[1] ? Number(m[1].replace(':', '')) : 0;
        const mins = Number(m[2]);
        const secs = Number(m[3]);
        const totalSec = hrs * 3600 + mins * 60 + secs;
        const label = m[4].trim();
        if (label && !seenTimes.has(totalSec) && mins < 60 && secs < 60) {
          seenTimes.add(totalSec);
          chapters.push({timeSeconds: totalSec, label});
        }
      }
    }
    chapters.sort((a, b) => a.timeSeconds - b.timeSeconds);
  }

  return {
    videoId,
    title,
    authorName,
    authorUrl,
    description,
    durationSeconds,
    thumbnailUrl,
    watchUrl,
    chapters: chapters.slice(0, 40),
  };
}

export async function getPlaylistVideos(listId: string, seedVideoId = '') {
  const urlsToTry = [
    `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}&playnext=1`,
    `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`,
  ];
  if (isValidVideoId(seedVideoId)) {
    urlsToTry.push(
      `https://www.youtube.com/watch?v=${encodeURIComponent(seedVideoId)}&list=${encodeURIComponent(listId)}&playnext=1`
    );
  } else if (listId.startsWith('RD') && listId.length >= 13) {
    const rdSeed = listId.slice(2, 13);
    if (isValidVideoId(rdSeed)) {
      urlsToTry.push(
        `https://www.youtube.com/watch?v=${encodeURIComponent(rdSeed)}&list=${encodeURIComponent(listId)}&playnext=1`
      );
    }
  }

  const seen = new Set<string>();
  const videos: ExtractedVideo[] = [];
  let playlistTitle = `Playlist (${listId})`;

  for (const targetUrl of urlsToTry) {
    try {
      const resp = await fetch(targetUrl, {
        headers: YT_HEADERS,
        signal: AbortSignal.timeout(7500),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      const data = extractYtInitialData(html);
      if (!data) continue;

      const plHeader = (data.header as {playlistHeaderRenderer?: {title?: unknown}} | undefined)
        ?.playlistHeaderRenderer;
      const extractedTitle = extractText(plHeader?.title);
      if (extractedTitle) playlistTitle = extractedTitle;

      for (const key of ['playlistVideoRenderer', 'playlistPanelVideoRenderer']) {
        for (const raw of collectByKey(data, key)) {
          const item = normalizeLegacyVideoRenderer(raw as Record<string, unknown>);
          if (item && !seen.has(item.videoId)) {
            seen.add(item.videoId);
            videos.push(item);
          }
        }
      }

      if (videos.length > 0) break;
    } catch {
      // Try next URL candidate
    }
  }

  return {
    listId,
    playlistTitle,
    videos: videos.slice(0, 60),
  };
}

export async function getChannelVideos(rawHandle: string) {
  const isExplicitHandleOrUrl =
    rawHandle.startsWith('@') ||
    /^https?:\/\//i.test(rawHandle) ||
    rawHandle.startsWith('/channel/') ||
    rawHandle.startsWith('/c/') ||
    rawHandle.startsWith('/@');

  if (isExplicitHandleOrUrl) {
    let candidatePath = rawHandle;
    if (/^https?:\/\//i.test(candidatePath)) {
      const u = new URL(candidatePath);
      candidatePath = u.pathname;
    }
    candidatePath = candidatePath.replace(/\/(videos|shorts|streams|featured|playlists).*$/i, '');
    if (!candidatePath.startsWith('/')) {
      candidatePath = `/${candidatePath}`;
    }

    try {
      const result = await fetchChannelVideosByPath(candidatePath);
      const relatedChannels = await searchChannelsOnly(rawHandle.replace(/^@/, ''));
      if (result.videos.length > 0) {
        return {...result, matchingChannels: relatedChannels};
      }
    } catch {
      // Fall through to channel-only search below
    }
  }

  const matchingChannels = await searchChannelsOnly(rawHandle.replace(/^@/, ''));
  if (matchingChannels.length > 0) {
    const topChannel = matchingChannels[0];
    const result = await fetchChannelVideosByPath(topChannel.handle);
    return {
      channelTitle: result.channelTitle || topChannel.title,
      handle: topChannel.handle,
      subscriberText: topChannel.subscriberText,
      videos: result.videos,
      matchingChannels,
    };
  }

  return null;
}

export async function searchYouTube(
  query: string,
  filter: 'all' | 'videos' | 'channels' | 'playlists' = 'all'
): Promise<{
  channels: ExtractedChannel[];
  playlists: ExtractedPlaylist[];
  videos: ExtractedVideo[];
}> {
  let spParam = '';
  if (filter === 'channels') spParam = '&sp=EgIQAg%3D%3D';
  else if (filter === 'playlists') spParam = '&sp=EgIQAw%3D%3D';
  else if (filter === 'videos') spParam = '&sp=EgIQAQ%3D%3D';

  const resp = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${spParam}`,
    {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(7500),
    }
  );
  if (!resp.ok) {
    throw new Error(`Search failed (${resp.status})`);
  }
  const html = await resp.text();
  const data = extractYtInitialData(html);
  if (!data) {
    throw new Error('Could not parse YouTube search results');
  }

  const channels: ExtractedChannel[] = [];
  const seenChannels = new Set<string>();
  for (const raw of collectByKey(data, 'channelRenderer')) {
    const ch = raw as Record<string, unknown>;
    const channelId = String(ch.channelId || '');
    const title = extractText(ch.title);
    const nav = (ch.navigationEndpoint as {browseEndpoint?: {canonicalBaseUrl?: string}} | undefined)
      ?.browseEndpoint?.canonicalBaseUrl;
    const handle = nav || (channelId ? `/channel/${channelId}` : '');
    const subscriberText =
      extractText(ch.videoCountText) || extractText(ch.subscriberCountText);
    if (channelId && title && handle && !seenChannels.has(channelId)) {
      seenChannels.add(channelId);
      channels.push({channelId, title, handle, subscriberText});
    }
  }

  const playlists: ExtractedPlaylist[] = [];
  const seenPlaylists = new Set<string>();
  for (const raw of collectByKey(data, 'lockupViewModel')) {
    const lv = raw as Record<string, unknown>;
    if (lv.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' && typeof lv.contentId === 'string') {
      const listId = lv.contentId;
      if (!seenPlaylists.has(listId)) {
        seenPlaylists.add(listId);
        const meta = (lv.metadata as Record<string, unknown> | undefined)?.lockupMetadataViewModel as
          | Record<string, unknown>
          | undefined;
        const title = extractText(meta?.title) || `Playlist (${listId})`;
        playlists.push({
          listId,
          title,
          authorName: 'YouTube Playlist',
          videoCountText: '',
          playlistUrl: `https://www.youtube.com/playlist?list=${listId}`,
        });
      }
    }
  }
  for (const raw of collectByKey(data, 'playlistRenderer')) {
    const pl = raw as Record<string, unknown>;
    const listId = String(pl.playlistId || '');
    if (listId && !seenPlaylists.has(listId)) {
      seenPlaylists.add(listId);
      playlists.push({
        listId,
        title: extractText(pl.title) || `Playlist (${listId})`,
        authorName: extractText(pl.shortBylineText) || 'YouTube Playlist',
        videoCountText: extractText(pl.videoCountText) || `${pl.videoCount || ''} videos`,
        playlistUrl: `https://www.youtube.com/playlist?list=${listId}`,
      });
    }
  }

  const videos: ExtractedVideo[] = [];
  const seenVideos = new Set<string>();
  for (const raw of collectByKey(data, 'videoRenderer')) {
    const item = normalizeLegacyVideoRenderer(raw as Record<string, unknown>);
    if (item && !seenVideos.has(item.videoId)) {
      seenVideos.add(item.videoId);
      videos.push(item);
    }
  }
  for (const raw of collectByKey(data, 'lockupViewModel')) {
    const lv = raw as Record<string, unknown>;
    if (lv.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
      const item = normalizeLockupVideo(lv, 'YouTube');
      if (item && !seenVideos.has(item.videoId)) {
        seenVideos.add(item.videoId);
        videos.push(item);
      }
    }
  }

  return {
    channels: channels.slice(0, 10),
    playlists: playlists.slice(0, 10),
    videos: videos.slice(0, 35),
  };
}

export async function getRelatedVideos(videoId: string): Promise<ExtractedVideo[]> {
  const resp = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: YT_HEADERS,
    signal: AbortSignal.timeout(7500),
  });
  if (!resp.ok) {
    throw new Error(`Related lookup returned ${resp.status}`);
  }
  const html = await resp.text();
  const data = extractYtInitialData(html);
  if (!data) {
    return [];
  }

  const secondary =
    (
      data.contents as
        | {twoColumnWatchNextResults?: {secondaryResults?: {secondaryResults?: unknown}}}
        | undefined
    )?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults || data;

  const seen = new Set<string>([videoId]);
  const related: ExtractedVideo[] = [];

  for (const raw of collectByKey(secondary, 'lockupViewModel')) {
    const lv = raw as Record<string, unknown>;
    if (lv.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') continue;
    const item = normalizeLockupVideo(lv, '');
    if (item && !seen.has(item.videoId)) {
      seen.add(item.videoId);
      related.push(item);
    }
  }

  for (const raw of collectByKey(secondary, 'compactVideoRenderer')) {
    const item = normalizeLegacyVideoRenderer(raw as Record<string, unknown>);
    if (item && !seen.has(item.videoId)) {
      seen.add(item.videoId);
      related.push(item);
    }
  }

  return related.slice(0, 36);
}

export async function getThumbnailBinary(videoId: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  const candidates = [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];

  for (const candidate of candidates) {
    try {
      const imgResp = await fetch(candidate, {
        signal: AbortSignal.timeout(5500),
      });
      if (imgResp.ok) {
        const arrayBuf = await imgResp.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        if (buf.length > 1200) {
          return {
            buffer: buf,
            contentType: imgResp.headers.get('content-type') || 'image/jpeg',
          };
        }
      }
    } catch {
      // Try next resolution candidate
    }
  }

  return null;
}

export interface ExtractedReel {
  videoId: string;
  title: string;
  authorName: string;
  viewText: string;
  thumbnailUrl: string;
  shortsUrl: string;
}

const REEL_TOPIC_POOLS: Record<string, string[]> = {
  all: [
    'trending viral #shorts',
    'hindi song status #shorts',
    'funny comedy #shorts',
    'amazing tech gadgets #shorts',
    'music beats dance #shorts',
    'cricket moments #shorts',
    'motivation life #shorts',
    'nature 4k beauty #shorts',
    'gaming clips #shorts',
    'science facts #shorts',
  ],
  music: [
    'hindi song status #shorts',
    'arijit singh song #shorts',
    'lofi remix beats #shorts',
    'punjabi song status #shorts',
    'english pop song #shorts',
    'guitar cover #shorts',
  ],
  comedy: [
    'funny comedy #shorts',
    'standup comedy clip #shorts',
    'memes funny #shorts',
    'prank laugh #shorts',
  ],
  tech: [
    'ai tech tips #shorts',
    'cool gadgets #shorts',
    'coding programming #shorts',
    'smartphone tricks #shorts',
  ],
  motivation: [
    'motivation speech #shorts',
    'success mindset #shorts',
    'fitness workout #shorts',
    'discipline focus #shorts',
  ],
  gaming: [
    'gaming clutch #shorts',
    'minecraft gta #shorts',
    'bgmi freefire #shorts',
    'esports highlights #shorts',
  ],
};

export async function getReelsFeed(
  topic = 'all',
  page = 0
): Promise<{reels: ExtractedReel[]; topic: string; page: number; nextPage: number}> {
  const cleanTopic = (topic || 'all').trim().toLowerCase();
  const pool = REEL_TOPIC_POOLS[cleanTopic] || [
    `${cleanTopic} #shorts`,
    `${cleanTopic} #youtubeshorts`,
    `${cleanTopic} viral #shorts`,
    `${cleanTopic} best #shorts`,
  ];

  const query = pool[Math.abs(page) % pool.length];
  const resp = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIYAQ%3D%3D`,
    {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!resp.ok) {
    throw new Error(`Reels fetch failed (${resp.status})`);
  }

  const html = await resp.text();
  const data = extractYtInitialData(html);
  const reels: ExtractedReel[] = [];
  const seen = new Set<string>();

  if (data) {
    for (const raw of collectByKey(data, 'shortsLockupViewModel')) {
      const s = raw as {
        onTap?: {innertubeCommand?: {reelWatchEndpoint?: {videoId?: string}}};
        overlayMetadata?: {
          primaryText?: {content?: string};
          secondaryText?: {content?: string};
        };
        thumbnailViewModel?: {
          thumbnailViewModel?: {image?: {sources?: Array<{url?: string}>}};
        };
      };

      const videoId = String(s?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || '').trim();
      if (!isValidVideoId(videoId) || seen.has(videoId)) continue;
      seen.add(videoId);

      const title =
        s?.overlayMetadata?.primaryText?.content?.trim() || `YouTube Short (${videoId})`;
      const viewText = s?.overlayMetadata?.secondaryText?.content?.trim() || '';
      const rawThumb = s?.thumbnailViewModel?.thumbnailViewModel?.image?.sources?.[0]?.url;
      const thumbnailUrl = rawThumb || `https://i.ytimg.com/vi/${videoId}/oar2.jpg`;

      reels.push({
        videoId,
        title,
        authorName: cleanTopic === 'all' ? 'YouTube Shorts' : `#${cleanTopic}`,
        viewText,
        thumbnailUrl,
        shortsUrl: `https://www.youtube.com/shorts/${videoId}`,
      });
    }

    // Supplement with short legacy videos (< 90s) if Shorts shelf had fewer items
    if (reels.length < 10) {
      for (const raw of collectByKey(data, 'videoRenderer')) {
        const item = normalizeLegacyVideoRenderer(raw as Record<string, unknown>);
        if (
          item &&
          !seen.has(item.videoId) &&
          (item.durationSeconds === null || item.durationSeconds <= 95)
        ) {
          seen.add(item.videoId);
          reels.push({
            videoId: item.videoId,
            title: item.title,
            authorName: item.authorName || 'YouTube Shorts',
            viewText: item.viewText,
            thumbnailUrl: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
            shortsUrl: `https://www.youtube.com/shorts/${item.videoId}`,
          });
        }
      }
    }
  }

  return {
    reels: reels.slice(0, 30),
    topic: cleanTopic,
    page,
    nextPage: page + 1,
  };
}

