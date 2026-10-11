#!/bin/sh
# Optional local hook: cp tools/pre-push-guard.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
node scripts/integrity-guard.mjs --base origin/main || { echo "Push blocked by AJN integrity guard"; exit 1; }
