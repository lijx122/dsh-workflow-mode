import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Automatically ensures that the n8n-workflow skill is installed into ~/.dsh/skills/n8n-workflow
 */
export function ensureN8nWorkflowSkillInstalled(): void {
  try {
    const userHome = os.homedir();
    const targetDir = path.join(userHome, '.dsh', 'skills', 'n8n-workflow');
    const targetFile = path.join(targetDir, 'SKILL.md');

    // Bundled skill path
    const candidatePaths = [
      path.resolve(__dirname, '../../../skills/n8n-workflow/SKILL.md'),
      path.resolve(__dirname, '../../skills/n8n-workflow/SKILL.md'),
      path.resolve(__dirname, '../skills/n8n-workflow/SKILL.md'),
    ];

    const sourcePath = candidatePaths.find((p) => fs.existsSync(p));
    if (!sourcePath) return;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy or update if not exists
    if (!fs.existsSync(targetFile)) {
      fs.copyFileSync(sourcePath, targetFile);
      console.log('[dsh-workflow] n8n-workflow skill auto-installed to:', targetFile);
    }
  } catch (error) {
    console.warn('[dsh-workflow] Skill auto-install failed:', error);
  }
}
