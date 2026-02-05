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
  if ((baseCategory === "file_read" || baseCategory === "file_write") && isCredentialTarget(target)) {
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

export function extractTarget(toolName: string, params: Record<string, unknown>): string | undefined {
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
      target: extractTarget(toolName, params),
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
