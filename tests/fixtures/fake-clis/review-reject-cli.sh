#!/usr/bin/env bash
# 审阅替身（changes_requested / 按计数翻转）：
# 默认每次都 changes_requested；设 FAKE_REVIEW_FLIP_FILE 时按调用计数
# （文件行数 = 已调用次数）先 reject 后 approved——驱动"一轮修复后通过"路径。
if [ "$1" = "--version" ]; then echo "review-reject-standin 1.0"; exit 0; fi
verdict="changes_requested"
if [ -n "$FAKE_REVIEW_FLIP_FILE" ]; then
  count=0
  [ -f "$FAKE_REVIEW_FLIP_FILE" ] && count=$(wc -l < "$FAKE_REVIEW_FLIP_FILE" | tr -d ' ')
  echo x >> "$FAKE_REVIEW_FLIP_FILE"
  if [ "$count" -ge 1 ]; then verdict="approved"; fi
fi
echo "{\"verdict\":\"$verdict\",\"comments\":\"审阅意见：请补充测试覆盖\"}"
