#!/usr/bin/env bash
# 替身：对 --version 探测友好（exit 0），实际执行则失败
if [ "$1" = "--version" ]; then echo "fail-standin 1.0"; exit 0; fi
echo "boom: simulated CLI failure" >&2
exit 1
