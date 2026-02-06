/**
 * R6 Framework - Intent → Action → Result
 *
 * R6 = Rules + Role + Request + Reference + Resource → Result
 *
 * Every tool call gets a structured R6 record that captures intent,
 * context, and outcome for audit and trust evaluation.
 */

import { createHash, randomUUID } from "node:crypto";

export type R6Request = {
  id: string;
  timestamp: string;
  rules: R6Rules;
  role: R6Role;
  request: R6RequestDetail;
  reference: R6Reference;
  resource: R6Resource;
  result?: R6Result;
};

export type R6Rules = {
  auditLevel: string;
  constraints: string[];
  /** Policy entity ID (policy as first-class trust participant) */
  policyEntityId?: string;
};

export type R6Role = {
  sessionId: string;
  agentId?: string;
  actionIndex: number;
  bindingType: "soft-lct";
};

export type R6RequestDetail = {
  toolName: string;
  category: ToolCategory;
  target?: string;
  /** Additional targets for multi-file operations (glob, batch commands) */
  targets?: string[];
  inputHash: string;
};

export type R6Reference = {
  sessionId: string;
  prevR6Id?: string;
  chainPosition: number;
};

export type R6Resource = {
  estimatedTokens?: number;
  approvalRequired: boolean;
};

export type R6Result = {
  status: "success" | "error" | "blocked";
  outputHash?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type ToolCategory =
  | "file_read"
  | "file_write"
  | "credential_access"
  | "command"
  | "network"
  | "delegation"
  | "state"
  | "mcp"
  | "unknown";

/** Patterns that indicate credential/secret file access */
const CREDENTIAL_PATTERNS = [
  /\.env$/i,
  /\.env\.[^/]+$/i,
  /credentials\.[^/]+$/i,
  /secrets?\.[^/]+$/i,
  /\.aws\/credentials$/i,
  /\.ssh\/id_[^/]+$/i,
  /\.ssh\/known_hosts$/i,
  /\.netrc$/i,
  /\.pgpass$/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
  /token[^/]*\.json$/i,
  /auth[^/]*\.json$/i,
  /apikey[^/]*$/i,
];

/** Check if a target path matches credential file patterns */
export function isCredentialTarget(target: string | undefined): boolean {
  if (!target) return false;
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(target));
}

/** Patterns that indicate agent memory file access */
const MEMORY_FILE_PATTERNS = [
  /MEMORY\.md$/i,
  /memory\.md$/i,
  /\/memory\/[^/]+\.md$/i,
  /\.moltbot\/.*memory/i,
  /\.clawdbot\/.*memory/i,
  /\.openclaw\/.*memory/i,
];

/** Check if a target path matches memory file patterns */
export function isMemoryTarget(target: string | undefined): boolean {
  if (!target) return false;
  return MEMORY_FILE_PATTERNS.some((pattern) => pattern.test(target));
}

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  Read: "file_read",
  Glob: "file_read",
  Grep: "file_read",
  Write: "file_write",
  Edit: "file_write",
  NotebookEdit: "file_write",
  Bash: "command",
  WebFetch: "network",
  WebSearch: "network",
  Task: "delegation",
  TodoWrite: "state",
};

export function classifyTool(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] ?? "unknown";
}

/**
 * Classify tool with target context - may upgrade to credential_access
 * if the target matches credential file patterns.
 */
export function classifyToolWithTarget(toolName: string, target: string | undefined): ToolCategory {
  const baseCategory = TOOL_CATEGORIES[toolName] ?? "unknown";

  // Upgrade file_read to credential_access if target matches credential patterns
  if (
    (baseCategory === "file_read" || baseCategory === "file_write") &&
    isCredentialTarget(target)
  ) {
    return "credential_access";
  }

  return baseCategory;
}

export function hashInput(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}

export function hashOutput(output: unknown): string {
  const str = typeof output === "string" ? output : JSON.stringify(output);
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

export function extractTarget(
  toolName: string,
  params: Record<string, unknown>,
): string | undefined {
  if (params.file_path) return String(params.file_path);
  if (params.path) return String(params.path);
  if (params.pattern) return String(params.pattern);
  if (params.command) {
    const cmd = String(params.command);
    return cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd;
  }
  if (params.url) return String(params.url);
  return undefined;
}

/**
 * Extract all targets from tool parameters for multi-file operations.
 * Returns an array of all identifiable targets (paths, patterns, URLs).
 */
export function extractTargets(toolName: string, params: Record<string, unknown>): string[] {
  const targets: string[] = [];

  // Direct file paths
  if (params.file_path) targets.push(String(params.file_path));
  if (params.path) targets.push(String(params.path));

  // Glob patterns (may match multiple files)
  if (params.pattern) targets.push(String(params.pattern));

  // URLs
  if (params.url) targets.push(String(params.url));

  // Bash commands - extract file paths from command string
  if (params.command && toolName === "Bash") {
    const cmd = String(params.command);
    const extracted = extractPathsFromCommand(cmd);
    targets.push(...extracted);
  }

  // Task tool - check for file references in prompt
  if (params.prompt && toolName === "Task") {
    const prompt = String(params.prompt);
    const extracted = extractPathsFromText(prompt);
    targets.push(...extracted);
  }

  // Edit tool - old_string might reference files
  if (params.old_string && toolName === "Edit") {
    // file_path is the primary target, already captured above
  }

  // Grep tool - may have additional path context
  if (params.glob && toolName === "Grep") {
    targets.push(String(params.glob));
  }

  // Deduplicate and return
  return [...new Set(targets)];
}

/**
 * Extract file paths from a bash command string.
 * Identifies common path patterns in commands.
 */
function extractPathsFromCommand(cmd: string): string[] {
  const paths: string[] = [];

  // Match absolute paths
  const absolutePathRegex = /(?:^|\s)(\/[^\s;|&<>'"]+)/g;
  let match;
  while ((match = absolutePathRegex.exec(cmd)) !== null) {
    const path = match[1]!;
    // Filter out common non-file arguments
    if (!path.startsWith("/dev/") && !path.startsWith("/proc/") && !path.startsWith("/sys/")) {
      paths.push(path);
    }
  }

  // Match relative paths with common extensions
  const relativePathRegex = /(?:^|\s)(\.{0,2}\/[^\s;|&<>'"]+\.[a-zA-Z0-9]+)/g;
  while ((match = relativePathRegex.exec(cmd)) !== null) {
    paths.push(match[1]!);
  }

  // Match home directory paths
  const homePathRegex = /(?:^|\s)(~\/[^\s;|&<>'"]+)/g;
  while ((match = homePathRegex.exec(cmd)) !== null) {
    paths.push(match[1]!);
  }

  return paths;
}

/**
 * Extract file paths mentioned in text (e.g., Task prompts).
 * Looks for path-like patterns.
 */
function extractPathsFromText(text: string): string[] {
  const paths: string[] = [];

  // Match paths in backticks or quotes
  const quotedPathRegex = /[`"']([/~][^`"'\s]+)[`"']/g;
  let match;
  while ((match = quotedPathRegex.exec(text)) !== null) {
    paths.push(match[1]!);
  }

  // Match standalone absolute paths
  const absolutePathRegex = /\s(\/[^\s,;:]+\.[a-zA-Z0-9]+)/g;
  while ((match = absolutePathRegex.exec(text)) !== null) {
    paths.push(match[1]!);
  }

  return paths;
}

export function createR6Request(
  sessionId: string,
  agentId: string | undefined,
  toolName: string,
  params: Record<string, unknown>,
  actionIndex: number,
  prevR6Id: string | undefined,
  auditLevel: string,
  policyEntityId?: string,
): R6Request {
  const primaryTarget = extractTarget(toolName, params);
  const allTargets = extractTargets(toolName, params);

  // Only include targets array if there are multiple unique targets
  const hasMultipleTargets =
    allTargets.length > 1 || (allTargets.length === 1 && allTargets[0] !== primaryTarget);

  return {
    id: `r6:${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    rules: {
      auditLevel,
      constraints: [],
      policyEntityId,
    },
    role: {
      sessionId,
      agentId,
      actionIndex,
      bindingType: "soft-lct",
    },
    request: {
      toolName,
      category: classifyTool(toolName),
      target: primaryTarget,
      targets: hasMultipleTargets ? allTargets : undefined,
      inputHash: hashInput(params),
    },
    reference: {
      sessionId,
      prevR6Id,
      chainPosition: actionIndex,
    },
    resource: {
      approvalRequired: false,
    },
  };
}
