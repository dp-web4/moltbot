/**
 * Moltbot Email Channel Plugin
 *
 * Enables 4-Tron (and other agents) to send and receive email via IMAP/SMTP.
 * Full implementation with connection testing, inbox checking, and sending.
 */

import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

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

type EmailMessage = {
  uid: number;
  messageId?: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: Date;
  snippet?: string;
  flags?: string[];
};

// Connection cache
const imapConnections = new Map<string, ImapFlow>();
const smtpTransports = new Map<string, nodemailer.Transporter>();

function getImapConfig(acct: EmailAccount) {
  return {
    host: acct.imap?.host ?? "imap.gmail.com",
    port: acct.imap?.port ?? 993,
    secure: acct.imap?.secure ?? true,
    auth: {
      user: acct.email,
      pass: acct.password ?? "",
    },
    logger: false,
  };
}

function getSmtpConfig(acct: EmailAccount) {
  return {
    host: acct.smtp?.host ?? "smtp.gmail.com",
    port: acct.smtp?.port ?? 587,
    secure: acct.smtp?.secure ?? false,
    auth: {
      user: acct.email,
      pass: acct.password ?? "",
    },
  };
}

async function connectImap(acct: EmailAccount): Promise<ImapFlow> {
  const existing = imapConnections.get(acct.id);
  if (existing && existing.usable) {
    return existing;
  }

  const client = new ImapFlow(getImapConfig(acct));
  await client.connect();
  imapConnections.set(acct.id, client);
  return client;
}

async function disconnectImap(accountId: string): Promise<void> {
  const client = imapConnections.get(accountId);
  if (client) {
    await client.logout();
    imapConnections.delete(accountId);
  }
}

function getSmtpTransport(acct: EmailAccount): nodemailer.Transporter {
  const existing = smtpTransports.get(acct.id);
  if (existing) {
    return existing;
  }

  const transport = nodemailer.createTransport(getSmtpConfig(acct));
  smtpTransports.set(acct.id, transport);
  return transport;
}

async function testImapConnection(acct: EmailAccount): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new ImapFlow(getImapConfig(acct));
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function testSmtpConnection(acct: EmailAccount): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = nodemailer.createTransport(getSmtpConfig(acct));
    await transport.verify();
    transport.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchRecentEmails(
  acct: EmailAccount,
  folder: string = "INBOX",
  limit: number = 10,
): Promise<EmailMessage[]> {
  const client = await connectImap(acct);
  const messages: EmailMessage[] = [];

  const lock = await client.getMailboxLock(folder);
  try {
    // Get the last N messages
    const mailbox = client.mailbox;
    if (!mailbox || mailbox.exists === 0) {
      return [];
    }

    const startSeq = Math.max(1, mailbox.exists - limit + 1);
    const range = `${startSeq}:*`;

    for await (const msg of client.fetch(range, {
      uid: true,
      envelope: true,
      flags: true,
      bodyStructure: true,
    })) {
      const envelope = msg.envelope;
      messages.push({
        uid: msg.uid,
        messageId: envelope?.messageId,
        from: envelope?.from?.[0]?.address,
        to: envelope?.to?.[0]?.address,
        subject: envelope?.subject,
        date: envelope?.date,
        flags: Array.from(msg.flags || []),
      });
    }
  } finally {
    lock.release();
  }

  // Return in reverse chronological order
  return messages.reverse();
}

async function fetchEmailBody(
  acct: EmailAccount,
  uid: number,
  folder: string = "INBOX",
): Promise<string | null> {
  const client = await connectImap(acct);

  const lock = await client.getMailboxLock(folder);
  try {
    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    if (msg?.source) {
      // Parse the source to extract text body (simplified)
      const source = msg.source.toString();
      // Try to find plain text part
      const textMatch = source.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
      if (textMatch) {
        return textMatch[1].trim();
      }
      // Fallback: return first 1000 chars
      return source.slice(0, 1000);
    }
    return null;
  } finally {
    lock.release();
  }
}

async function sendEmail(
  acct: EmailAccount,
  to: string,
  subject: string,
  body: string,
  options?: {
    inReplyTo?: string;
    references?: string;
    html?: string;
  },
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const transport = getSmtpTransport(acct);

    const result = await transport.sendMail({
      from: acct.email,
      to,
      subject,
      text: body,
      html: options?.html,
      inReplyTo: options?.inReplyTo,
      references: options?.references,
    });

    return { ok: true, messageId: result.messageId };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

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

    // Helper to find account
    function findAccount(accountId?: string): EmailAccount | undefined {
      if (accountId) {
        return accounts.find((a) => a.id === accountId);
      }
      return accounts[0];
    }

    // Register CLI commands
    api.registerCli(
      ({ program, logger }) => {
        const email = program.command("email").description("Email channel management");

        // --- Status ---
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
              const connected = imapConnections.has(acct.id) ? "connected" : "disconnected";

              logger.info(`  ${acct.id} [${connected}]`);
              logger.info(`    email:    ${acct.email}`);
              logger.info(`    password: ${hasPassword}`);
              logger.info(`    IMAP:     ${imapHost}:${imapPort}`);
              logger.info(`    SMTP:     ${smtpHost}:${smtpPort}`);
              logger.info(`    folders:  ${(acct.folders ?? ["INBOX"]).join(", ")}`);
            }
          });

        // --- Test Connection ---
        email
          .command("test")
          .description("Test IMAP and SMTP connections")
          .argument("[accountId]", "Account ID to test (default: first account)")
          .action(async (accountId?: string) => {
            const acct = findAccount(accountId);
            if (!acct) {
              logger.info(accountId ? `Account "${accountId}" not found.` : "No accounts configured.");
              return;
            }

            if (!acct.password) {
              logger.info(`Account "${acct.id}" has no password configured.`);
              return;
            }

            logger.info(`Testing account: ${acct.id} (${acct.email})`);

            // Test IMAP
            logger.info("  Testing IMAP connection...");
            const imapResult = await testImapConnection(acct);
            if (imapResult.ok) {
              logger.info("  IMAP: OK");
            } else {
              logger.info(`  IMAP: FAILED - ${imapResult.error}`);
            }

            // Test SMTP
            logger.info("  Testing SMTP connection...");
            const smtpResult = await testSmtpConnection(acct);
            if (smtpResult.ok) {
              logger.info("  SMTP: OK");
            } else {
              logger.info(`  SMTP: FAILED - ${smtpResult.error}`);
            }
          });

        // --- Check Inbox ---
        email
          .command("check")
          .description("Check inbox for recent emails")
          .argument("[accountId]", "Account ID (default: first account)")
          .option("-n, --limit <n>", "Number of emails to fetch", "10")
          .option("-f, --folder <folder>", "Folder to check", "INBOX")
          .action(async (accountId: string | undefined, opts: { limit: string; folder: string }) => {
            const acct = findAccount(accountId);
            if (!acct) {
              logger.info(accountId ? `Account "${accountId}" not found.` : "No accounts configured.");
              return;
            }

            if (!acct.password) {
              logger.info(`Account "${acct.id}" has no password configured.`);
              return;
            }

            const limit = parseInt(opts.limit, 10) || 10;
            logger.info(`Checking ${opts.folder} for ${acct.id} (${acct.email})...`);

            try {
              const messages = await fetchRecentEmails(acct, opts.folder, limit);
              if (messages.length === 0) {
                logger.info("No messages found.");
                return;
              }

              logger.info(`${messages.length} recent message(s):`);
              for (const msg of messages) {
                const date = msg.date ? msg.date.toISOString().slice(0, 16).replace("T", " ") : "unknown";
                const flags = msg.flags?.includes("\\Seen") ? "" : " [NEW]";
                const from = msg.from ?? "unknown";
                const subject = msg.subject ?? "(no subject)";
                logger.info(`  [${msg.uid}] ${date}${flags}`);
                logger.info(`    From: ${from}`);
                logger.info(`    Subject: ${subject}`);
              }
            } catch (err) {
              logger.info(`Failed to check inbox: ${String(err)}`);
            }
          });

        // --- Read Email ---
        email
          .command("read")
          .description("Read a specific email by UID")
          .argument("<uid>", "Email UID")
          .argument("[accountId]", "Account ID (default: first account)")
          .option("-f, --folder <folder>", "Folder", "INBOX")
          .action(async (uidStr: string, accountId: string | undefined, opts: { folder: string }) => {
            const acct = findAccount(accountId);
            if (!acct) {
              logger.info(accountId ? `Account "${accountId}" not found.` : "No accounts configured.");
              return;
            }

            const uid = parseInt(uidStr, 10);
            if (!uid) {
              logger.info("Invalid UID.");
              return;
            }

            try {
              const body = await fetchEmailBody(acct, uid, opts.folder);
              if (body) {
                logger.info(`Email ${uid} content:`);
                logger.info("---");
                logger.info(body);
                logger.info("---");
              } else {
                logger.info(`Email ${uid} not found or empty.`);
              }
            } catch (err) {
              logger.info(`Failed to read email: ${String(err)}`);
            }
          });

        // --- Send Email ---
        email
          .command("send")
          .description("Send an email")
          .argument("<to>", "Recipient email address")
          .option("-s, --subject <subject>", "Email subject", "Message from 4-Tron")
          .option("-b, --body <body>", "Email body")
          .option("-a, --account <accountId>", "Account ID to send from")
          .action(async (to: string, opts: { subject: string; body?: string; account?: string }) => {
            const acct = findAccount(opts.account);
            if (!acct) {
              logger.info(opts.account ? `Account "${opts.account}" not found.` : "No accounts configured.");
              return;
            }

            if (!acct.password) {
              logger.info(`Account "${acct.id}" has no password configured.`);
              return;
            }

            const body = opts.body ?? "This is a test message from 4-Tron.";

            logger.info(`Sending email from ${acct.email} to ${to}...`);
            const result = await sendEmail(acct, to, opts.subject, body);

            if (result.ok) {
              logger.info(`Email sent successfully!`);
              logger.info(`  Message-ID: ${result.messageId}`);
            } else {
              logger.info(`Failed to send email: ${result.error}`);
            }
          });

        // --- Connect/Disconnect ---
        email
          .command("connect")
          .description("Establish persistent IMAP connection")
          .argument("[accountId]", "Account ID (default: first account)")
          .action(async (accountId?: string) => {
            const acct = findAccount(accountId);
            if (!acct) {
              logger.info(accountId ? `Account "${accountId}" not found.` : "No accounts configured.");
              return;
            }

            if (!acct.password) {
              logger.info(`Account "${acct.id}" has no password configured.`);
              return;
            }

            logger.info(`Connecting to IMAP for ${acct.id}...`);
            try {
              await connectImap(acct);
              logger.info(`Connected to ${acct.email}`);
            } catch (err) {
              logger.info(`Failed to connect: ${String(err)}`);
            }
          });

        email
          .command("disconnect")
          .description("Disconnect IMAP connection")
          .argument("[accountId]", "Account ID (default: first account)")
          .action(async (accountId?: string) => {
            const acct = findAccount(accountId);
            if (!acct) {
              logger.info(accountId ? `Account "${accountId}" not found.` : "No accounts configured.");
              return;
            }

            logger.info(`Disconnecting ${acct.id}...`);
            await disconnectImap(acct.id);
            logger.info(`Disconnected.`);
          });
      },
      { commands: ["email"] },
    );

    // Export functions for agent use
    (api as unknown as Record<string, unknown>).emailChannel = {
      sendEmail: async (accountId: string, to: string, subject: string, body: string, options?: {
        inReplyTo?: string;
        references?: string;
      }) => {
        const acct = findAccount(accountId);
        if (!acct) {
          return { ok: false, error: `Account "${accountId}" not found` };
        }
        return sendEmail(acct, to, subject, body, options);
      },
      checkInbox: async (accountId: string, folder?: string, limit?: number) => {
        const acct = findAccount(accountId);
        if (!acct) {
          return [];
        }
        return fetchRecentEmails(acct, folder, limit);
      },
      readEmail: async (accountId: string, uid: number, folder?: string) => {
        const acct = findAccount(accountId);
        if (!acct) {
          return null;
        }
        return fetchEmailBody(acct, uid, folder);
      },
    };

    logger.info("[email] Email plugin loaded with IMAP/SMTP support");
  },
};

export default plugin;
