#!/usr/bin/env bash
# 派生孙进程后长眠——进程组 kill 覆盖孙进程的断言载体
echo $$ > "${FAKE_CLI_PIDFILE:?FAKE_CLI_PIDFILE required}"
sleep 300 &
echo $! > "${FAKE_CLI_PIDFILE}.child"
sleep 300
