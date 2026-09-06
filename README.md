# Jelly Baby · 匿名小桌

基于 [scottstts/Jelly-Baby](https://github.com/scottstts/Jelly-Baby) 的轻量多人玩法，使用 Cloudflare Workers + Durable Objects 托管。

打开网页自动入桌，每桌最多 6 人，满桌自动分流。没有账号、昵称、聊天、玩家列表、战绩或胜负；离开即结束。WASD / 方向键走动，空格跳跃，Shift 冲撞，拖动桌面转动视角；按住自己的果冻可拉伸和甩动，约 22 cm 内的其他果冻也可以拖拉。松手释放，不新增按钮。手机使用原版摇杆与跳跃按钮。保留原版界面与文案，仅新增人数显示，移除颜色选择入口；只使用自动生成的渐变色。桌面开放，不显示圆圈，也不限制圆形活动范围。

配色由 Cloudflare 提供的 IP 与常规浏览器属性摘要，经服务器私有盐 HMAC 生成，始终为双色渐变。应用不保存原始 IP、浏览器属性或指纹摘要，不设置身份 Cookie 或 localStorage，不向其他玩家发送指纹。每次入场只有一个新的临时连接 ID。相同环境一般得到相同颜色；网络或浏览器属性变化可能改变颜色，有限颜色空间不保证数学上的绝对唯一。

## 运行与部署

```sh
npm install
npm run dev
```

`dev` 先构建前端，然后在本地 Wrangler 中运行真实房间服务。前端热更新可另开终端运行 `npm run dev:client`，Vite 会将 `/api` 和 WebSocket 代理到 Wrangler 的 8787 端口。

```sh
npx wrangler login
npm run deploy
```

`wrangler.jsonc` 部署 `jelly-baby-playground`，静态文件和 WebSocket API 同域。SQLite Durable Objects 迁移自动创建房间和匹配器命名空间，不需要外部数据库或配置配色密钥。

## 实现边界

- 服务器 30 Hz 调度、每次 3 个碰撞子步运行简化碰撞体，有变化时最多 15 Hz 广播量化后的必要状态，静止状态每秒保活一次；移动方向归一化，跳跃与冲撞冷却由服务器决定。碰撞体不是逐顶点软体碰撞。
- 本地保留即时软体运动，只平滑纠正明显的服务器位置偏差；小误差和静止落地高度不会唤醒软体或触发光学重算。利用测得的往返时间补偿快照延迟，远端角色使用约 100 毫秒的快照插值缓冲。
- 所有角色均使用原版完整分辨率皮肤、240 Hz FEM 求解、步态和表情动画。其他角色在浏览器本地 Web Worker 中计算，每个角色最多一个在途请求，复用可转移缓冲区，主线程只更新网格。其他角色仍未单独运行光学追踪。抓取绑定实际皮肤，拉别人时伸出自己原有的手，连接被抓皮肤的实际位置；松手撤销约束。服务器校验距离与所有权，限制拉力并保留释放动量。自动配色使用明亮的相近色渐变，保留原有着色器与吸收计算。
- 握手座位 20 秒过期且只能使用一次；连接有消息大小、速率限制和同源检查。输入超过 350 毫秒未更新就停止移动，失联 15 秒释放座位。空桌停止计时器。断线明确提示重新加入，不切换成假联机或单人模式。
- 匹配器串行分配避免同时入场超员；每次最多查找最近 32 桌。房间游戏状态是临时的，部署或服务重启后需重新加入。
- 仍然要求支持 WebGPU 的 HTTPS 浏览器；没有 WebGL 回退。保留原版模型、HDR 和纹理，首次加载资源量仍较大。多人协议轻量不代表原版渲染对所有手机都轻量。

## 验证

```sh
npm run lint
npm run typecheck
npm run test:online
npm run test:drag
npm run test:reconcile
npm run test:remote
npm run test:impact
npm run build
npm run test:rooms
npm run test:physics
npm run test:multitouch
npm run test:performance
```

`test:online` 验证输入、碰撞、跳跃、冲撞冷却、6 人持续稳定性与配色确定性；`test:rooms` 在 Miniflare/workerd 中验证并发入桌、容量、真实 WebSocket 广播、离场复用、座位重放拒绝、颜色隐私与禁止聊天。房间测试使用临时本地存储，不访问线上玩家。

遵循仓库要求，未启动开发服务器做浏览器视觉检查。最终视觉、触屏手感和 WebGPU 性能需在目标浏览器验收。

碰撞通过带序号且短时保留的接触事件传给本地及远端软体，在接触位置施加局部冲量和翻转力矩。轻碰挤压晃动，较强撞击短暂放松站立控制，允许真实软体倒地并逐渐恢复；不修改模型缩放或着色器。相机保持原版默认距离和缩放范围。
