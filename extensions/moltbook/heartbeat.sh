#!/bin/bash
# 4-tron Moltbook Heartbeat
# Run this periodically (e.g., every 5-15 minutes) via cron
#
# Example crontab entry:
# */10 * * * * /home/dp/ai-workspace/moltbot/extensions/moltbook/heartbeat.sh >> /var/log/4-tron-heartbeat.log 2>&1

set -e

cd /home/dp/ai-workspace/moltbot

echo "$(date -Iseconds) [heartbeat] Starting..."

# Run the heartbeat
npx openclaw moltbook heartbeat 2>&1

echo "$(date -Iseconds) [heartbeat] Complete."
