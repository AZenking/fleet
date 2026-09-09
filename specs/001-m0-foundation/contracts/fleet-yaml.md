# Contract: configs/fleet.yaml（M0）

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

字段定义见 [data-model.md](../data-model.md) §1；本契约固化文件级
行为。

## 位置与发现

- 标准位置：仓库根下 `configs/fleet.yaml`（roadmap §11 基线）。
- 从任意子目录运行 CLI 时：先定位 git 仓库根（`.git` 向上查找），
  再于仓库根下解析 `configs/fleet.yaml`。
- 非 git 目录中：无法定位仓库根 → `fleet-config` 检查项 error
  （与 `git-repo` 检查项联动报错，不重复报警）。

## 最小合法示例

```yaml
version: 1
```

## 完整示例（M0 支持的全部字段）

```yaml
version: 1
repository: .                        # 缺省 = 仓库根
defaults:
  maxConcurrency: 3                  # 1–64，缺省 3
  retry: 1                           # 0–10，缺省 1
  budget:                            # 占位组：M0 只存储不解释
    maxTokensPerMission: 1000000
    maxDurationMinutes: 60
```

## 错误语义（FR-007）

任何校验失败产生 `CONFIG_INVALID` FleetError，`context.issues` 为
逐字段数组，每项含：

- `path`：点分字段路径（如 `defaults.maxConcurrency`）
- `expected`：期望（如 "integer in 1..64"）
- `received`：实际值
- `message`：一句人话说明

特例：文件缺失 → `CONFIG_MISSING`；存在但为空 → `CONFIG_EMPTY`
（detail 说明"配置为空"）。

## 版本演进

`version` 为整数，当前仅 `1`。未来新增可选字段不破坏 v1；不兼容
变更递增 version 并由加载器按 version 分派 schema（M0 不实现多版本，
仅校验 =1）。
