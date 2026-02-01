# OpenClaw Email Channel Plugin

IMAP/SMTP email communication for OpenClaw agents.

## Features

- **IMAP polling** - Monitor inbox for incoming emails
- **SMTP sending** - Send emails as replies or new messages
- **Conversation threading** - Maintains Message-ID/In-Reply-To chain
- **Multiple accounts** - Support for multiple email identities
- **Auto-reply** - Agents can automatically respond to emails

## Configuration

Add to `~/.openclaw/moltbot.json`:

```json
{
  "plugins": {
    "entries": {
      "email": {
        "enabled": true,
        "config": {
          "accounts": [
            {
              "id": "4-tron",
              "email": "${FOURTRON_EMAIL}",
              "password": "${FOURTRON_PASSWORD}",
              "imap": {
                "host": "imap.gmail.com",
                "port": 993,
                "secure": true
              },
              "smtp": {
                "host": "smtp.gmail.com",
                "port": 587,
                "secure": false
              },
              "pollInterval": 60000,
              "folders": ["INBOX"]
            }
          ],
          "autoReply": true
        }
      }
    }
  }
}
```

## Environment Variables

Store credentials in your `.env` file (never in config):

```bash
FOURTRON_EMAIL=4-tron@dpcars.net
FOURTRON_PASSWORD=your-app-password
```

## Gmail Setup

For Gmail/Google Workspace:

1. Enable 2FA on the account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the App Password (not your regular password) in the config
4. Enable IMAP in Gmail settings

## CLI Commands

```bash
# Check account status
openclaw email status

# Send a test email
openclaw email send --to user@example.com --subject "Hello" --body "Test message"

# Check for new emails
openclaw email check
```

## Agent Integration

Agents can send emails using the channel API:

```typescript
await agent.channels.send("email", "4-tron", "recipient@example.com", {
  text: "Hello from 4-Tron!",
  metadata: {
    subject: "Greetings",
  },
});
```

## Security Notes

- **Never commit credentials** - Use environment variables
- **Use App Passwords** - Not your main account password
- **Credentials location** - Store in `private-context/` not public repos
