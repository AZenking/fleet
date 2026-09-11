#!/usr/bin/env bash
# 写动作替身：探测友好；实际执行按 prompt 中的 [任务 <id>] 标记写 <id>.txt
if [ "$1" = "--version" ]; then echo "write-standin 1.0"; exit 0; fi
name=$(printf '%s' "$*" | grep -o '\[任务 [^]]*\]' | head -1 | sed 's/\[任务 //;s/\]//')
file="${FAKE_WRITE_FILE:-${name:-default}.txt}"
printf 'written by %s\n' "${name:-unknown}" > "$file"
echo "wrote $file"
