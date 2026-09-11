#!/usr/bin/env bash
# 审阅替身（approved）：探测友好；实际执行印 JSON 裁决（CliRuntimeAdapter 捕获 stdout → output）
if [ "$1" = "--version" ]; then echo "review-approved-standin 1.0"; exit 0; fi
echo '{"verdict":"approved","comments":"实现与验证证据一致，批准合入"}'
