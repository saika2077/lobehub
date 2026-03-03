/**
 * Agent execution mode
 * - auto: automatically decide execution strategy
 * - plan: plan first then execute, suitable for complex tasks
 * - ask: ask for user confirmation before execution
 * - implement: execute directly without asking
 */
export type AgentMode = 'auto' | 'plan' | 'ask' | 'implement';

/**
 * Local System configuration (desktop only)
 */
export interface LocalSystemConfig {
  /**
   * Whether Local System is enabled (desktop only, default true on desktop)
   */
  enabled?: boolean;
  /**
   * Local System working directory (desktop only)
   */
  workingDirectory?: string;

  // Future extensions:
  // allowedPaths?: string[];
  // deniedCommands?: string[];
}
