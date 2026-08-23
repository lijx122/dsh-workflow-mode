// Cordis host plugin entry for @dsh-workflow/client-ui-workflow
// Keeps the Node.js server entry purely clean without importing client React/CSS modules.
export const name = "@dsh-workflow/client-ui-workflow";

export function apply(): void {}

// Re-export pure type definitions
export * from "./types.js";
export const PKG_NAME = "@dsh-workflow/client-ui-workflow";
