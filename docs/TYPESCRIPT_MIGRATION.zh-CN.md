# TypeScript 技术栈与维护说明

全量业务实现已转换为 TS/TSX。范围、清点、运行策略与验证边界见 [迁移结果](TYPESCRIPT_MIGRATION_STATUS.zh-CN.md)，文件级动态类型债务见 [清单](typescript-type-debt.json)。本次采用用户确认的“先完成全量语言迁移和运行兼容，再逐步收紧动态类型”标准。

## 工具链

保留 React 19、Vite 8、Zustand、Node HTTP API、JSON 存储和 Capacitor 架构。TypeScript 7、React/Node 类型与 Leaflet/Web Push 声明在根开发依赖中安装。各应用仍分别维护依赖和锁文件，未切换 npm workspaces。

此前兼容更新包括 Capacitor 8.6、React Router 7.18.5、MCP SDK 1.32.2 等；框架和认证依赖的跨大版本升级单独进行。最低 Node 版本为 22.18，原生加载 `.ts`；生产继续使用已有 Node 22.23.4 镜像。

## 日常命令

```bash
npm ci
npm --prefix frontend ci --ignore-scripts
npm --prefix api ci --omit=optional
npm --prefix mcp ci
npm run typecheck
npm run check:migration
```

类型工具集中在根目录，因此只安装子包依赖不能替代根 `npm ci`。编译检查分为前端、Service Worker、API、MCP；Vite 构建不会自动替代类型检查。MCP 复用的训练辅助函数包含受运行时守卫保护的浏览器能力，类型检查引入 DOM 声明不表示 Node 运行时必须提供 DOM。

前端入口为 `src/main.tsx`，API 入口为 `server.ts`，MCP 入口为 `src/index.ts`。默认启动命令已更新。旧 JS/JSX 文件仅作兼容转发。Service Worker 的 JS 是生成产物，修改其 TS 源码后运行 `npm --prefix frontend run build:worker`。

## 后续类型治理

1. 优先定义训练组、动作条目、训练记录、计划、完整业务状态与同步元数据，再逐个替换遗留动态类型。
2. 网络、文件和导入内容应以 `unknown` 接收，通过真实运行时校验缩小范围；不能把类型断言当成校验。
3. 区分存储、网络协议与界面模型，明确日期、时间戳、重量单位和旧数据可选字段。
4. 收紧类型时同时运行相关测试；涉及同步、删除、历史修订和跨端共享规则时执行完整回归与纯 Node 加载检查。
5. 使用 `import type`，不引入只有浏览器才能加载的运行时依赖到 MCP/Node 共享路径。
6. 清单中的显式动态类型是已知迁移债务；新增精确类型模块应保持严格约束，避免进一步扩大债务。

CI 已加入类型和迁移清点检查。独立 TypeScript 工作流是否成为合并必需项，由仓库分支规则决定。
