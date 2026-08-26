import { type Context, Service } from '@deepseek-ai/cordis';
import http from 'node:http';
import { startN8nService, checkN8nHealth } from './n8n-daemon.js';

export interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
  }): () => void;
  registerUpgrade?(route: {
    path: string;
    handler: (req: http.IncomingMessage, socket: any, head: Buffer) => void;
  }): () => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer?: WebServerService;
  }
}

/** Hop-by-hop headers that MUST NOT be forwarded by a proxy. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
  'te',
  'trailer',
]);

/** Allowed upstream origin — never change to anything other than localhost. */
const UPSTREAM_ORIGIN = 'http://127.0.0.1:5678';

/**
 * Attaches a reverse proxy under /api/n8n/ directly on DSH's native webServer.
 * When client accesses https://<dsh-domain>/api/n8n/*, it proxies in-memory
 * to the locally spawned n8n instance (127.0.0.1:5678), completely eliminating CORS and port blocks.
 */
export function attachN8nProxyRoute(ctx: Context): (() => void) | undefined {
  if (!ctx.webServer || typeof ctx.webServer.register !== 'function') {
    return undefined;
  }

  // 1. 注册 API 代理前缀路由 /api/n8n/
  const unregisterHttp = ctx.webServer.register({
    kind: 'prefix',
    path: '/api/n8n/',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse) => {
      // --- C6: CSRF / Origin validation ---
      const origin = req.headers['origin'] as string | undefined;
      const secFetchSite = req.headers['sec-fetch-site'] as string | undefined;

      if (origin) {
        try {
          const originUrl = new URL(origin);
          // Allow only same-origin requests (Origin matches the DSH Host header)
          if (originUrl.host !== req.headers.host) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'cross_origin_forbidden' }));
            return;
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'invalid_origin' }));
          return;
        }
      }

      if (secFetchSite === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'cross_site_forbidden' }));
        return;
      }

      // --- P0-1 加固：仅放行浏览器同源请求 ---
      // sec-fetch-site 缺失（curl/脚本/顶层导航部分场景）一律拒绝，
      // 配合上游 n8n 的 127.0.0.1 绑定 + Basic Auth 形成三层防线
      if (secFetchSite !== 'same-origin') {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'same_origin_required' }));
        return;
      }

      // 自动按需激活
      const isOnline = await checkN8nHealth(5678, 800);
      if (!isOnline) {
        void startN8nService();
      }

      // --- C1: SSRF-safe URL construction ---
      const rawPath = (req.url || '').replace(/^\/api\/n8n/, '') || '/';

      // Ensure path starts with / to prevent host injection via URL parsing
      // (e.g. "@evil.com:80/foo" would be interpreted as user:password@host)
      if (!rawPath.startsWith('/')) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'invalid_path' }));
        return;
      }

      const targetUrl = `${UPSTREAM_ORIGIN}${rawPath}`;
      const parsedTarget = new URL(targetUrl);

      // Double-check that the origin hasn't been tampered with
      if (parsedTarget.origin !== UPSTREAM_ORIGIN) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'upstream_origin_mismatch' }));
        return;
      }

      // --- Filter hop-by-hop headers from request forwarding ---
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
          headers[key] = value;
        }
      }
      headers['host'] = '127.0.0.1:5678';

      const proxyReq = http.request(
        {
          hostname: parsedTarget.hostname,
          port: parsedTarget.port,
          path: parsedTarget.pathname + parsedTarget.search,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          // Build response headers: replace insecure values, filter hop-by-hop
          const resHeaders: Record<string, string | string[] | undefined> = {};
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            const lowerKey = key.toLowerCase();
            // Skip hop-by-hop headers from upstream response too
            if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;

            if (lowerKey === 'x-frame-options') {
              // Replace with safe value instead of deleting
              resHeaders[key] = 'SAMEORIGIN';
            } else if (lowerKey === 'content-security-policy') {
              // Ensure frame-ancestors is present; append if missing
              const csp = Array.isArray(value) ? value.join(', ') : String(value);
              resHeaders[key] = csp.includes('frame-ancestors')
                ? csp
                : `${csp}; frame-ancestors 'self'`;
            } else {
              resHeaders[key] = value;
            }
          }
          res.writeHead(proxyRes.statusCode || 200, resHeaders);
          proxyRes.pipe(res);
        },
      );

      // --- Client disconnect cleanup ---
      const onClientClose = () => {
        proxyReq.destroy();
      };
      req.on('close', onClientClose);

      proxyReq.on('error', (err) => {
        req.off('close', onClientClose);
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'n8n_gateway_offline', message: err.message }));
        }
      });

      req.pipe(proxyReq);
    },
  });

  return () => {
    unregisterHttp();
  };
}