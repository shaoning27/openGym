# TypeScript 全量业务迁移结果

## 完成标准

本次按用户确认的标准完成语言迁移：所有业务实现使用 TS/TSX，并保持现有运行方式；遗留动态类型显式保留、单独记录。**这不代表所有领域模型和外部数据边界都已完成精确建模。**

清点结果为 297 个 TS/TSX 源码模块、293 个旧路径兼容入口和 60 个翻译/生成数据资源模块，业务目录没有剩余的 JS/JSX 业务实现。详细文件列表和按文件统计的类型债务见 [typescript-type-debt.json](typescript-type-debt.json)。其中包含约 2.2 万处显式动态类型标注，后续应优先收紧状态、同步、训练主引擎、HTTP 和模型提供方边界。

## 覆盖范围

- 前端：全部页面、组件、操作面板、Zustand 状态、训练与进阶、历史统计、恢复模型、同步合并、导入导出和原生桥接。
- API：主 HTTP 服务、账号与 Passkey、设备配对、密码与限流、文件持久化、媒体、提醒、管理及教练任务和适配器。
- MCP：入口、数据读取、HTTP 客户端、读写工具与国际化标签。
- Service Worker：维护源码为 `frontend/src/service-worker.ts`，通过 `frontend/scripts/build-service-worker.mjs` 生成浏览器可执行的 `frontend/public/sw.js`。
- 构建与交付：应用和 Node 入口、测试/模拟引用、镜像打包、Nix 文件复制规则、CI、源码扫描与文档引用同步更新。

原生 Swift/Kotlin/Java、构建和测试工具脚本不属于本次业务语言转换；测试仍可使用 JS/JSX。动作数据库、翻译和媒体继续使用原资源格式。旧 JS/JSX 路径只转发导出，不保留业务逻辑，以兼容旧调用者和账号恢复命令。

## 类型与运行策略

保持 `strict: true`，不使用批量 `@ts-ignore`、`@ts-nocheck` 或关闭编译检查。未经完整领域建模的旧模块采用显式 `any` 和必要的边界断言，原有精确类型模块继续保留类型约束。显式动态类型仍允许不安全的操作，因此类型检查通过不能替代运行时校验或回归测试。

Node 使用原生类型剥离，最低版本为 22.18；生产镜像原有 Node 22.23.4 满足要求。TSX 由 Vite 构建。Service Worker 使用独立 WebWorker 类型环境，生成的 JS 仍为经典脚本；正常开发、测试、Web 与移动端构建命令会先更新该文件。

`npm run check:migration` 检查业务目录的 JS 遗留、兼容入口、类型债务清单和 Service Worker 生成结果。新增 JS 业务实现或过期清单会导致检查失败。修改类型标注后运行：

```bash
node scripts/ci/check-typescript-migration.mjs --write
```

## 复现验证

```bash
npm ci
npm --prefix frontend ci --ignore-scripts
npm --prefix api ci --omit=optional
npm --prefix mcp ci
npm run typecheck
npm run check:migration
npm --prefix frontend run build
npm --prefix frontend test -- --maxWorkers=3
npm --prefix api test
TZ=UTC npm --prefix mcp test
node api/scripts/check-core-loadable.mjs
npm --prefix mcp run check:node-loadable
node scripts/build-coach-assets.mjs --check
node scripts/build-api-docs.mjs --check
```

API 的日志断言增加了对完整子进程日志行的等待：HTTP 响应与 stderr 是独立流，响应先到达不表示日志已被测试进程接收。原有日志内容断言保留。

## 验证边界

完整生产 API Docker 构建在 Alpine 软件源 `dl-cdn.alpinelinux.org` 返回 HTTP 403 时受阻，未跳过包升级或关闭 TLS 校验。另以同版本 Node Alpine 镜像、相同源码与已安装依赖验证文件打包和运行；该验证镜像不等同于完整生产镜像构建。原生手机、商店发布、Nix 完整构建和真实 AI 提供方调用未验证。

## 最终验证结果

- 前端生产构建通过；543 个测试文件中的 6,538 项测试全部通过。
- API 完整回归 696 项通过，无跳过；MCP 完整回归 128 项通过。
- 前端、独立 Service Worker、API、MCP 的类型检查与迁移清点通过。
- Node 22.23.4 的主服务健康、认证与修订接口 33 项集成测试通过；MCP 和教练核心可由原生 Node 直接加载。
- 隔离 Node 22 Alpine 验证镜像中的 TS 服务启动、存储可写、配置读取、密码注册与账号持久化通过；该镜像只用于验证，不作为生产镜像发布。
- 教练生成资源与 API 文档一致性检查通过；2,123 个界面翻译字符串均存在于语言包。
- 完整生产 Docker 构建、原生手机构建、Nix 构建和真实 AI 提供方调用的限制见上节，不计入已通过项。
