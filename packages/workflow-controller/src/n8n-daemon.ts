import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

export interface N8nStartResult {
  ok: boolean;
  message: string;
  port?: number;
}

let n8nProcess: ChildProcess | null = null;
// C5: Singleton startup promise — concurrent callers share one in-flight startup
let startupPromise: Promise<N8nStartResult> | null = null;

// P0-1: n8n 基础认证凭据 —— 每次进程启动随机生成一次，进程生命周期内保持稳定，
// 供同源代理 (n8n-proxy-route) 转发请求时注入 Authorization 头。
let basicAuthPassword: string | null = null;

export interface N8nBasicAuth {
  user: string;
  password: string;
}

export function getN8nBasicAuth(): N8nBasicAuth {
  return { user: 'dsh', password: basicAuthPassword ?? '' };
}

/**
 * Check if n8n service is already running on port 5678 or 8080
 */
export function checkN8nHealth(port = 5678, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/rest/settings`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Locate n8n custom installation root.
 * Only relative paths (relative to process.cwd()) and the N8N_CUSTOM_DIR
 * environment variable are used — no hardcoded absolute paths.
 */
function findN8nCustomDir(): string | null {
  const candidateDirs = [
    ...(process.env.N8N_CUSTOM_DIR ? [process.env.N8N_CUSTOM_DIR] : []),
    path.resolve(process.cwd(), '../n8n-custom'),
    path.resolve(process.cwd(), 'n8n-custom'),
  ];
  return candidateDirs.find((d) => fs.existsSync(path.join(d, 'packages/cli/bin/n8n'))) || null;
}

/**
 * Perform the actual spawn + readiness polling. Must not be called while
 * another startup is in flight — startN8nService guarantees that.
 */
async function doStartN8nService(): Promise<N8nStartResult> {
  const n8nDir = findN8nCustomDir();
  if (!n8nDir) {
    return { ok: false, message: '未找到 n8n-custom 安装目录，请先确保已部署' };
  }

  try {
    const binPath = path.join(n8nDir, 'packages/cli/bin/n8n');
    // P0-1：每次启动生成随机 Basic Auth 凭据，n8n 强制只绑环回 + 开启认证，
    // 消除「0.0.0.0 监听 + 无认证管理台 → 未授权 RCE」暴露面
    basicAuthPassword = crypto.randomUUID();
    const env = {
      ...process.env,
      N8N_PORT: '5678',
      N8N_LISTEN_ADDRESS: '127.0.0.1',
      N8N_BASIC_AUTH_ACTIVE: 'true',
      N8N_BASIC_AUTH_USER: 'dsh',
      N8N_BASIC_AUTH_PASSWORD: basicAuthPassword,
      N8N_DEFAULT_LOCALE: 'zh',
      N8N_DIAGNOSTICS_ENABLED: 'false',
      N8N_PERSONALIZATION_ENABLED: 'false',
      N8N_HIRING_BANNER_ENABLED: 'false',
      N8N_TEMPLATES_ENABLED: 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
      N8N_COMMUNITY_PACKAGES_ENABLED: 'false',
      NODE_OPTIONS: '--max-old-space-size=512',
      DSH_API_BASE_URL: process.env.DSH_API_BASE_URL || 'https://web.shieldcell.cn/v1',
    };

    n8nProcess = spawn(process.execPath, [binPath], {
      cwd: n8nDir,
      env,
      stdio: 'ignore',
      detached: true,
    });

    n8nProcess.unref();

    // Poll until ready
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const ok = await checkN8nHealth(5678);
      if (ok) {
        return { ok: true, message: 'n8n 引擎启动成功！', port: 5678 };
      }
    }

    return { ok: true, message: 'n8n 引擎已发起后台启动' };
  } catch (error: any) {
    return { ok: false, message: `启动失败: ${error?.message || error}` };
  }
}

/**
 * Automatically start n8n backend service.
 * Thread-safe: concurrent callers receive the same in-flight startup promise
 * instead of spawning multiple n8n processes (C5).
 */
export function startN8nService(): Promise<N8nStartResult> {
  return checkN8nHealth(5678).then((alreadyRunning) => {
    if (alreadyRunning) {
      return { ok: true, message: 'n8n 引擎已在运行中 (Port 5678 / 8080)', port: 8080 };
    }

    if (!startupPromise) {
      startupPromise = doStartN8nService().finally(() => {
        startupPromise = null;
      });
    }
    return startupPromise;
  });
}