import fs from "node:fs";
import path from "node:path";

export interface RetentionPolicy {
  maxRuns?: number;
  maxAgeDays?: number;
}

export class RetentionCleaner {
  readonly runsBaseDir: string;
  readonly policy: RetentionPolicy;

  constructor(runsBaseDir: string, policy: RetentionPolicy = {}) {
    this.runsBaseDir = runsBaseDir;
    this.policy = policy;
  }

  async clean(): Promise<{ removed: number }> {
    if (!fs.existsSync(this.runsBaseDir)) {
      return { removed: 0 };
    }

    const maxRuns = this.policy.maxRuns ?? 100;
    const maxAgeDays = this.policy.maxAgeDays ?? 7;
    const now = Date.now();
    const cutoffTime =
      typeof maxAgeDays === "number" && maxAgeDays > 0
        ? now - maxAgeDays * 24 * 60 * 60 * 1000
        : undefined;

    let removed = 0;

    try {
      const wfEntries = fs.readdirSync(this.runsBaseDir, { withFileTypes: true });
      for (const wfEntry of wfEntries) {
        if (!wfEntry.isDirectory()) continue;
        const wfDirPath = path.join(this.runsBaseDir, wfEntry.name);

        let runEntries: fs.Dirent[];
        try {
          runEntries = fs.readdirSync(wfDirPath, { withFileTypes: true });
        } catch {
          continue;
        }

        const validRuns: Array<{
          runId: string;
          runDir: string;
          startedAt: number;
        }> = [];

        for (const runEntry of runEntries) {
          if (!runEntry.isDirectory()) continue;
          const runDir = path.join(wfDirPath, runEntry.name);
          const runJsonPath = path.join(runDir, "run.json");

          try {
            if (!fs.existsSync(runJsonPath)) {
              continue;
            }
            const content = fs.readFileSync(runJsonPath, "utf-8");
            const data = JSON.parse(content);
            if (
              typeof data?.startedAt === "number" &&
              !Number.isNaN(data.startedAt) &&
              // 跳过进行中的运行：running / waiting_human 不可清理
              data.status !== "running" &&
              data.status !== "waiting_human"
            ) {
              validRuns.push({
                runId: runEntry.name,
                runDir,
                startedAt: data.startedAt,
              });
            }
          } catch {
            // 容错：跳过损坏的 run.json，不抛出异常
            continue;
          }
        }

        // 按 startedAt 降序排序（最新在前，最旧在后）
        validRuns.sort((a, b) => b.startedAt - a.startedAt);

        const toDelete = new Set<string>();

        // 1. 时间维度过期清理
        if (cutoffTime !== undefined) {
          for (const run of validRuns) {
            if (run.startedAt < cutoffTime) {
              toDelete.add(run.runDir);
            }
          }
        }

        // 2. 数量维度保留最新 maxRuns 个
        if (typeof maxRuns === "number" && maxRuns >= 0 && validRuns.length > maxRuns) {
          const excessRuns = validRuns.slice(maxRuns);
          for (const run of excessRuns) {
            toDelete.add(run.runDir);
          }
        }

        // 递归删除超限/过期的 run 目录
        for (const dirToDelete of toDelete) {
          try {
            fs.rmSync(dirToDelete, { recursive: true, force: true });
            removed++;
          } catch {
            // 忽略单目录删除异常
          }
        }
      }
    } catch {
      // 忽略目录扫描异常
    }

    return { removed };
  }
}
