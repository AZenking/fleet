#!/usr/bin/env bash
# 替身：回显全部参数 + 权限环境（断言 prompt/权限到达 CLI）
echo "ARGS: $*"
echo "PERM: ${FLEET_PERMISSION:-<missing>}"
echo "ROLE: ${FLEET_AGENT_ROLE:-<missing>}"
if [ -n "$FAKE_CLI_CALL_LOG" ]; then echo "call" >> "$FAKE_CLI_CALL_LOG"; fi
