/**
 * Web4 Governance Extension - Session Management
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2025 Web4 Contributors
 */

import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import type {
  SessionToken,
  GovernancePreferences,
  SessionState,
} from "./types.js";

const WEB4_DIR = join(homedir(), ".moltbot", "extensions", "web4-governance");
const SESSION_DIR = join(WEB4_DIR, "sessions");
const PREFERENCES_FILE = join(WEB4_DIR, "preferences.json");

/**
 * Create a software-bound session token.
 * In the full Web4 spec, this would be an LCT (Linked Context Token)
 * bound to hardware. This light version uses a software-derived token.
 */
export function createSessionToken(): SessionToken {
  const uid = userInfo().uid;
  const host = hostname();
  const timestamp = new Date().toISOString();
  const seed = `${host}:${uid}:${timestamp}:${randomBytes(8).toString("hex")}`;
  const tokenHash = createHash("sha256").update(seed).digest("hex").slice(0, 12);

  return {
    token_id: `web4:session:${tokenHash}`,
    binding: "software",
    created_at: new Date().toISOString(),
    machine_hint: createHash("sha256").update(host).digest("hex").slice(0, 8),
  };
}

/**
 * Load user governance preferences.
 */
export async function loadPreferences(): Promise<GovernancePreferences> {
  try {
    const data = await readFile(PREFERENCES_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    // Default preferences
    return {
      auditLevel: "standard",
      showR6Status: true,
      actionBudget: null,
    };
  }
}

/**
 * Initialize Web4 session state.
 */
export async function initializeSession(sessionId: string): Promise<SessionState> {
  await mkdir(SESSION_DIR, { recursive: true });

  const token = createSessionToken();
  const preferences = await loadPreferences();

  const session: SessionState = {
    session_id: sessionId,
    token,
    preferences,
    started_at: new Date().toISOString(),
    action_count: 0,
    r6_requests: [],
    audit_chain: [],
  };

  const sessionFile = join(SESSION_DIR, `${sessionId}.json`);
  await writeFile(sessionFile, JSON.stringify(session, null, 2));

  return session;
}

/**
 * Load session state.
 */
export async function loadSession(sessionId: string): Promise<SessionState | null> {
  try {
    const sessionFile = join(SESSION_DIR, `${sessionId}.json`);
    const data = await readFile(sessionFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Save session state.
 */
export async function saveSession(session: SessionState): Promise<void> {
  const sessionFile = join(SESSION_DIR, `${session.session_id}.json`);
  await writeFile(sessionFile, JSON.stringify(session, null, 2));
}

/**
 * Get Web4 directory paths.
 */
export function getWeb4Paths() {
  return {
    web4Dir: WEB4_DIR,
    sessionDir: SESSION_DIR,
    preferencesFile: PREFERENCES_FILE,
    auditDir: join(WEB4_DIR, "audit"),
    r6Dir: join(WEB4_DIR, "r6"),
  };
}
