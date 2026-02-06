# Installing Web4 Governance

This guide helps you add security and audit features to your OpenClaw/moltbot installation.

## What You'll Get

After installation, your AI agent will:

- Keep a tamper-proof log of everything it does
- Block dangerous commands (like `rm -rf /`)
- Alert you when it accesses sensitive files (passwords, API keys)
- Sign all records so you can prove what happened

## Step 1: Install the Plugin

Open your terminal and run:

```bash
openclaw plugins install @moltbot/web4-governance
```

You should see:

```
Installed plugin: web4-governance
Restart the gateway to load plugins.
```

## Step 2: Choose Your Security Level

Pick one:

### Option A: Recommended Security (blocks dangerous stuff)

```bash
openclaw config set plugins.web4-governance.policy.preset safety
```

### Option B: Audit Only (logs everything, blocks nothing)

```bash
openclaw config set plugins.web4-governance.policy.preset permissive
```

### Option C: Maximum Security (blocks by default)

```bash
openclaw config set plugins.web4-governance.policy.preset strict
```

## Step 3: Restart

Restart OpenClaw to activate:

```bash
openclaw gateway restart
```

## Step 4: Verify It's Working

Check the plugin is loaded:

```bash
openclaw plugins list
```

You should see `web4-governance` with status `loaded`.

Test the policy:

```bash
openclaw policy test Bash "rm -rf /"
```

With the `safety` preset, you should see `Decision: deny`.

## Troubleshooting

### "Plugin not found"

Make sure you have the latest OpenClaw:

```bash
npm update -g openclaw
```

### "Command not found: openclaw"

Install OpenClaw first:

```bash
npm install -g openclaw
```

### Plugin shows "error" status

Check what's wrong:

```bash
openclaw plugins doctor
```

## Need Help?

- Full documentation: See [README.md](./README.md)
- Technical details: See [ARCHITECTURE.md](./ARCHITECTURE.md)
- Report issues: https://github.com/openclaw/openclaw/issues
