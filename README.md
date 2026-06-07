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

## 对外分享

如果要把邀请链接直接分享给别人访问，需要在启动时指定外网基址：

```bash
PUBLIC_BASE_URL='https://your-public-domain.example.com' npm start
```

服务端会把这个地址注入到前端生成的邀请链接里，避免创建出 `127.0.0.1` 这种只能本机访问的链接。

## 目录

- `server.js`：Express + Socket.IO 服务端，负责房间、轮次、胜负、悔棋状态机
- `public/index.html`：页面结构
- `public/styles.css`：棋盘和面板样式
- `public/app.js`：前端状态同步与交互
