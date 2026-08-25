import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

let n8nProcess: ChildProcess | null = null;
let isStarting = false;

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
 * Locate n8n custom installation root
 */
function findN8nCustomDir(): string | null {
  const candidateDirs = [
    'D:\\documents\\DSH零散会话\\n8n-custom',
    path.resolve(process.cwd(), '../n8n-custom'),
    path.resolve(process.cwd(), 'n8n-custom'),
  ];
  return candidateDirs.find((d) => fs.existsSync(path.join(d, 'packages/cli/bin/n8n'))) || null;
}

/**
 * Automatically start n8n backend service
 */
export async function startN8nService(): Promise<{ ok: boolean; message: string; port?: number }> {
  const alreadyRunning = await checkN8nHealth(5678);
  if (alreadyRunning) {
    return { ok: true, message: 'n8n 引擎已在运行中 (Port 5678 / 8080)', port: 8080 };
  }

  if (isStarting) {
    return { ok: true, message: 'n8n 引擎正在启动中，请稍候...' };
  }

  const n8nDir = findN8nCustomDir();
  if (!n8nDir) {
    return { ok: false, message: '未找到 n8n-custom 安装目录，请先确保已部署' };
  }

  isStarting = true;
  try {
    const binPath = path.join(n8nDir, 'packages/cli/bin/n8n');
    const env = {
      ...process.env,
      N8N_PORT: '5678',
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
        isStarting = false;
        return { ok: true, message: 'n8n 引擎启动成功！', port: 5678 };
      }
    }

    isStarting = false;
    return { ok: true, message: 'n8n 引擎已发起后台启动' };
  } catch (error: any) {
    isStarting = false;
    return { ok: false, message: `启动失败: ${error?.message || error}` };
  }
}
