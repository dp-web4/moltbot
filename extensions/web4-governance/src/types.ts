/**
 * Web4 Governance Extension - Types
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2025 Web4 Contributors
 */

export type SessionToken = {
  token_id: string;
  binding: "software";
  created_at: string;
  machine_hint: string;
};

export type GovernancePreferences = {
  auditLevel: "minimal" | "standard" | "verbose";
  showR6Status: boolean;
  actionBudget: number | null;
};

export type R6Request = {
  request_id: string;
  rules: Record<string, unknown>;
  role: {
    session_id: string;
    action_index: number;
  };
  request: {
    tool: string;
    category: string;
    target?: string;
  };
  reference: {
    chain_position: number;
    prev_r6_id?: string;
  };
  resource?: {
    estimated_cost?: number;
  };
  result?: {
    status: "success" | "error" | "blocked";
    output_hash?: string;
    error?: string;
  };
  timestamp: string;
};

export type AuditRecord = {
  record_id: string;
  r6_request_id: string;
  tool: string;
  category: string;
  target?: string;
  result: {
    status: "success" | "error" | "blocked";
    output_hash?: string;
    error?: string;
  };
  provenance: {
    session_id: string;
    action_index: number;
    prev_record_hash?: string;
  };
  timestamp: string;
};

export type SessionState = {
  session_id: string;
  token: SessionToken;
  preferences: GovernancePreferences;
  started_at: string;
  action_count: number;
  r6_requests: R6Request[];
  audit_chain: AuditRecord[];
};
