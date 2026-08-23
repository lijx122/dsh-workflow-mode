// Minimal cordis plugin: exists only so the profile loader creates an entry
// named "@dsh-workflow/client-ui-workflow", letting the client-modules
// dsh.client scan discover the WorkflowCanvas declaration. No server behavior.
// Entry name MUST equal the npm package name: client-modules resolves
// dsh.client by looking up <entryName>/package.json.
export const name = "@dsh-workflow/client-ui-workflow";

export function apply(): void {}
