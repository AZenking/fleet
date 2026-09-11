#!/usr/bin/env bash
# 写 pid 文件（env 指定路径）后长眠——timeout/cancel 组杀与孤儿断言载体
echo $$ > "${FAKE_CLI_PIDFILE:?FAKE_CLI_PIDFILE required}"
sleep 300
