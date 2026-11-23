import type {IncomingMessage, ServerResponse} from 'http';
import {sendJson} from '../lib/vercelHttp.js';

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 200, {ok: true, timestamp: Date.now()});
}
