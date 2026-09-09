# sample-repo（调查测试夹具）

已知符号清单（测试断言的锚点）：

| 符号                           | 文件                   | 说明                                          |
| ------------------------------ | ---------------------- | --------------------------------------------- |
| `PaymentService`（class）      | `src/payment.ts`       | 正常路径主符号                                |
| `charge`（method）             | `src/payment.ts`       | 方法级符号                                    |
| `parseInvoice`（function）     | `src/payment.ts`       | 函数符号                                      |
| `Logger`（class）              | `src/logging.ts`       | 同名符号第 1 处                               |
| `Logger`（class）              | `src/notify.ts`        | 同名符号第 2 处（歧义场景）                   |
| `getRate`（function）          | `src/config-driven.ts` | 行为由 `config/rates.yaml` 驱动（高风险场景） |
| `generatedHandler`（function） | `src/generated-api.ts` | 带 `@generated` 标记（高风险场景）            |

e2e 测试会在本目录执行 `codegraph init`（夹具准备，等同 git init 的
地位）并在结束后清理 `.codegraph/`。
