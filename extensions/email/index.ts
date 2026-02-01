/**
 * Moltbot Email Channel Plugin
 *
 * Enables 4-Tron (and other agents) to send and receive email via IMAP/SMTP.
 * Initial implementation with status and test commands.
 */

import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";

type EmailAccount = {
  id: string;
  email: string;
  password?: string;
  imap?: {
    host?: string;
    port?: number;
    secure?: boolean;
  };
  smtp?: {
    host?: string;
    port?: number;
    secure?: boolean;
  };
  pollInterval?: number;
  folders?: string[];
};

type PluginConfig = {
  accounts?: EmailAccount[];
  autoReply?: boolean;
};

const plugin = {
  id: "email",
  name: "Email Channel",
  description: "IMAP/SMTP email communication for agents",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      accounts: {
        type: "array",
        description: "Email accounts to connect",
        items: {
          type: "object",
          required: ["id", "email"],
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            password: { type: "string" },
            imap: {
              type: "object",
              properties: {
                host: { type: "string", default: "imap.gmail.com" },
                port: { type: "number", default: 993 },
                secure: { type: "boolean", default: true },
              },
            },
            smtp: {
              type: "object",
              properties: {
                host: { type: "string", default: "smtp.gmail.com" },
                port: { type: "number", default: 587 },
                secure: { type: "boolean", default: false },
              },
            },
            pollInterval: { type: "number", default: 60000 },
            folders: { type: "array", items: { type: "string" }, default: ["INBOX"] },
          },
        },
      },
      autoReply: { type: "boolean", default: true },
    },
  },

  register(api: MoltbotPluginApi) {
    const config = (api.pluginConfig ?? {}) as PluginConfig;
    const logger = api.logger;

    const accounts = config.accounts ?? [];
    logger.info(`[email] Email plugin registered with ${accounts.length} account(s)`);

    // Register CLI commands
    api.registerCli(
      ({ program, logger }) => {
        const email = program.command("email").description("Email channel management");

        email
          .command("status")
          .description("Show email account status")
          .action(() => {
            if (accounts.length === 0) {
              logger.info("No email accounts configured.");
              return;
            }
            logger.info(`${accounts.length} account(s) configured:`);
            for (const acct of accounts) {
              const imapHost = acct.imap?.host ?? "imap.gmail.com";
              const imapPort = acct.imap?.port ?? 993;
              const smtpHost = acct.smtp?.host ?? "smtp.gmail.com";
              const smtpPort = acct.smtp?.port ?? 587;
              const hasPassword = acct.password ? "configured" : "missing";

              logger.info(`  ${acct.id}`);
              logger.info(`    email:    ${acct.email}`);
              logger.info(`    password: ${hasPassword}`);
              logger.info(`    IMAP:     ${imapHost}:${imapPort}`);
              logger.info(`    SMTP:     ${smtpHost}:${smtpPort}`);
              logger.info(`    folders:  ${(acct.folders ?? ["INBOX"]).join(", ")}`);
            }
          });

        email
          .command("test")
          .description("Test email configuration")
          .argument("[accountId]", "Account ID to test (default: first account)")
          .action((accountId?: string) => {
            const acct = accountId
              ? accounts.find((a) => a.id === accountId)
              : accounts[0];

            if (!acct) {
              logger.info(accountId ? `Account "${accountId}" not found.` : "No accounts configured.");
              return;
            }

            logger.info(`Testing account: ${acct.id} (${acct.email})`);
            logger.info("  IMAP connection: not yet implemented");
            logger.info("  SMTP connection: not yet implemented");
            logger.info("\nFull IMAP/SMTP support coming soon.");
          });
      },
      { commands: ["email"] },
    );

    logger.info("[email] Email plugin loaded");
  },
};

export default plugin;
