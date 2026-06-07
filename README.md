# gomoku-now

一个可立即开玩的远程联机五子棋网页 MVP。

## 当前能力

- 25x25 棋盘
- 两人房间联机
- 实时同步落子
- 最后一手高亮
- 再来一局
- 申请悔棋 / 对方同意后回退最后一步
- 短时断线重连

## 本地启动

```bash
npm install
npm start
```

默认地址：

```text
http://127.0.0.1:3100
```

## 本地自测

```bash
npm run smoke
```

它会自动起本地服务、模拟两位玩家建房、落子、悔棋，并输出 JSON 结果。

## 对外分享

如果要把邀请链接直接分享给别人访问，需要在启动时指定外网基址：

```bash
PUBLIC_BASE_URL='https://your-public-domain.example.com' npm start
```

服务端会把这个地址注入到前端生成的邀请链接里，避免创建出 `127.0.0.1` 这种只能本机访问的链接。

如果只是想快速临时分享给别人试玩，可以直接：

```bash
npm run share
```

它会：

1. 启动本地 Node 服务
2. 通过 Cloudflare Quick Tunnel 暴露一个临时公网地址
3. 自动把该外网地址注入邀请链接

注意：这是临时试玩链路，不适合长期正式部署。

## 目录

- `server.js`：Express + Socket.IO 服务端，负责房间、轮次、胜负、悔棋状态机
- `public/index.html`：页面结构
- `public/styles.css`：棋盘和面板样式
- `public/app.js`：前端状态同步与交互
- `scripts/smoke-local.js`：本地双页联机 smoke
- `scripts/share-cloudflare.sh`：临时公网分享脚本
