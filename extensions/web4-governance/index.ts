/**
 * Web4 Governance Extension for Moltbot
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2025 Web4 Contributors
 *
 * Lightweight AI governance with R6 workflow formalism and audit trails.
 * https://github.com/dp-web4/web4
 */

import type { MoltbotPluginApi, MoltbotPluginDefinition } from "clawdbot/plugin-sdk";
import { initializeSession, loadSession, saveSession } from "./src/session.js";
import {
  createR6Request,
  finalizeR6Request,
  createAuditRecord,
  persistR6Request,
  persistAuditRecord,
} from "./src/r6.js";
import { handleAuditCommand } from "./src/audit-command.js";
import type { SessionState } from "./src/types.js";

// Active session store (in-memory, per-process)
const activeSessions = new Map<string, SessionState>();

const plugin: MoltbotPluginDefinition = {
  id: "web4-governance",
  name: "Web4 Governance",
  description:
    "Lightweight AI governance with R6 workflow formalism and audit trails. Every tool call becomes a structured request with verifiable provenance.",
  version: "1.0.0",

  async register(api: MoltbotPluginApi) {
    api.logger.info("Web4 Governance extension loaded");

    // Register session lifecycle hooks
    api.on("session_start", async (event, ctx) => {
      const sessionId = event.sessionId || ctx.sessionId;
      if (!sessionId) return;

      try {
        // Try to load existing session, or create new
        let session = await loadSession(sessionId);
        if (!session) {
          session = await initializeSession(sessionId);

          // Show status if preference enabled
          if (session.preferences.showR6Status && api.logger.info) {
            const tokenShort = session.token.token_id.split(":")[2];
            api.logger.info(`[Web4] Session ${tokenShort} (software-bound)`);
          }
        }

        // Store in active sessions
        activeSessions.set(sessionId, session);
      } catch (error) {
        api.logger.error(`Failed to initialize Web4 session: ${error}`);
      }
    });

    api.on("session_end", async (event, ctx) => {
      const sessionId = event.sessionId || ctx.sessionId;
      if (!sessionId) return;

      try {
        const session = activeSessions.get(sessionId);
        if (session) {
          // Final save
          await saveSession(session);
          activeSessions.delete(sessionId);

          if (api.logger.info) {
            api.logger.info(
              `[Web4] Session ended: ${session.action_count} actions audited`,
            );
          }
        }
      } catch (error) {
        api.logger.error(`Failed to finalize Web4 session: ${error}`);
      }
    });

    // Register tool call audit hooks
    api.on("before_tool_call", async (event, ctx) => {
      const sessionId = ctx.sessionKey || ctx.agentId;
      if (!sessionId) return;

      try {
        let session = activeSessions.get(sessionId);
        if (!session) {
          // Session might not be in memory, try to load
          session = await loadSession(sessionId);
          if (!session) {
            // Create session on-the-fly if needed
            session = await initializeSession(sessionId);
          }
          activeSessions.set(sessionId, session);
        }

        // Create R6 request
        const r6 = createR6Request(session, event.toolName, event.params);

        // Store R6 temporarily (will be finalized in after_tool_call)
        session.r6_requests.push(r6);

        // Persist R6 request
        await persistR6Request(r6);
      } catch (error) {
        api.logger.error(`Failed to create R6 request: ${error}`);
      }
    });

    api.on("after_tool_call", async (event, ctx) => {
      const sessionId = ctx.sessionKey || ctx.agentId;
      if (!sessionId) return;

      try {
        const session = activeSessions.get(sessionId);
        if (!session) return;

        // Get the pending R6 request
        const pendingR6 = session.r6_requests[session.r6_requests.length - 1];
        if (!pendingR6 || pendingR6.result) {
          // Already finalized or missing
          return;
        }

        // Finalize R6 with result
        const finalizedR6 = finalizeR6Request(pendingR6, event.result, event.error);
        session.r6_requests[session.r6_requests.length - 1] = finalizedR6;

        // Create audit record
        const auditRecord = createAuditRecord(finalizedR6, session);
        session.audit_chain.push(auditRecord);

        // Increment action count
        session.action_count++;

        // Persist audit record
        await persistAuditRecord(auditRecord, sessionId);

        // Save session state
        await saveSession(session);

        // Check action budget if configured
        if (
          session.preferences.actionBudget &&
          session.action_count >= session.preferences.actionBudget
        ) {
          api.logger.warn(
            `[Web4] Action budget reached: ${session.action_count}/${session.preferences.actionBudget}`,
          );
        }
      } catch (error) {
        api.logger.error(`Failed to finalize R6 request: ${error}`);
      }
    });

    // Register /audit command
    api.registerCommand({
      name: "audit",
      description: "Show Web4 governance audit summary and reports",
      acceptsArgs: true,
      requireAuth: true,
      handler: handleAuditCommand,
    });

    api.logger.info("Web4 Governance hooks and commands registered");
  },
};

export default plugin;
