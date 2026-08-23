// Minimal cordis plugin: exists only so the profile loader creates an entry
// named "@dsh-workflow/client-ui-workflow", letting the client-modules
// dsh.client scan discover the WorkflowCanvas declaration. No server behavior.
export const name = "@dsh-workflow/client-ui-workflow";

export function apply(): void {}
