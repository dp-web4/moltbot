# Installing Web4 Governance

This guide helps you add security and audit features to your OpenClaw installation.

## What You'll Get

After installation, your AI agent will:

- Keep a tamper-proof log of everything it does
- Block dangerous commands (like recursive deletes)
- Alert you when it accesses sensitive files (passwords, API keys)
- Sign all records so you can prove what happened

## Installation Options

### Option 1: Download and Install (Easiest)

1. **Download the extension**

   Download the latest release from GitHub:

   ```bash
   curl -L https://github.com/dp-web4/moltbot/releases/latest/download/web4-governance.tgz -o web4-governance.tgz
   ```

   Or download manually from the [releases page](https://github.com/dp-web4/moltbot/releases).

2. **Install the plugin**

   ```bash
   openclaw plugins install ./web4-governance.tgz
   ```

3. **Choose your security level**

   ```bash
   # Recommended: blocks dangerous stuff, warns on sensitive access
   openclaw config set plugins.web4-governance.policy.preset safety
   ```

4. **Restart OpenClaw**
   ```bash
   openclaw gateway restart
   ```

### Option 2: Clone and Install

1. **Clone the repository**

   ```bash
   git clone https://github.com/dp-web4/moltbot.git
   cd moltbot
   ```

2. **Install the plugin from the local directory**

   ```bash
   openclaw plugins install ./extensions/web4-governance
   ```

3. **Configure and restart** (same as Option 1, steps 3-4)

### Option 3: Link for Development

If you want to modify the extension or keep it synced with git:

```bash
git clone https://github.com/dp-web4/moltbot.git
cd moltbot
openclaw plugins install --link ./extensions/web4-governance
```

Changes to the source will be reflected immediately (after gateway restart).

## Security Presets

| Preset       | What it does                                      |
| ------------ | ------------------------------------------------- |
| `safety`     | Blocks dangerous commands + secrets, warns others |
| `permissive` | Logs everything, blocks nothing                   |
| `strict`     | Blocks by default, requires explicit allow rules  |
| `audit-only` | Records everything in dry-run mode                |

Set your preset:

```bash
openclaw config set plugins.web4-governance.policy.preset <preset-name>
```

## Verify Installation

```bash
# Check plugin is loaded
openclaw plugins list
# Should show: web4-governance  loaded

# Test the policy
openclaw policy test Bash "rm -rf important_folder"
# With 'safety' preset, should show: Decision: deny
```

## Troubleshooting

### "package.json missing openclaw.extensions"

You may have an older version. Re-download or pull the latest:

```bash
git pull origin main
openclaw plugins install ./extensions/web4-governance
```

### Plugin shows "error" status

Check the error details:

```bash
openclaw plugins doctor
openclaw plugins info web4-governance
```

### "Command not found: openclaw"

Install OpenClaw first:

```bash
npm install -g openclaw
```

## Uninstall

To remove the plugin:

```bash
openclaw plugins disable web4-governance
# Then delete: ~/.openclaw/extensions/web4-governance/
```

## Need Help?

- Full documentation: [README.md](./README.md)
- Technical details: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Report issues: https://github.com/dp-web4/moltbot/issues
