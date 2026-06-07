const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry(new Error(`Unexpected status: ${res.statusCode}`));
      });
      req.on("error", retry);
    };

    const retry = (error) => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(error);
        return;
      }
      setTimeout(ping, 250);
    };

    ping();
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(port));
      });
    });
    server.on("error", reject);
  });
}

async function runSmoke() {
  const port = process.env.PORT || await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: port, PUBLIC_BASE_URL: baseUrl },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(baseUrl);

    const browser = await chromium.launch({ headless: true });
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(baseUrl, { waitUntil: "networkidle" });
    await pageB.goto(baseUrl, { waitUntil: "networkidle" });

    await pageA.fill("#nameInput", "哥哥");
    await pageA.click("#createRoomBtn");
    await pageA.waitForFunction(() => document.querySelector("#roomCodeText")?.textContent?.trim() !== "-");
    const roomCode = await pageA.locator("#roomCodeText").innerText();

    await pageB.fill("#nameInput", "妹妹");
    await pageB.fill("#roomCodeInput", roomCode);
    await pageB.click("#joinRoomBtn");
    await pageA.waitForFunction(() => document.querySelector("#roomBadge")?.textContent?.includes("可开始"));

    await pageA.click("#startBtn");
    await pageA.locator(".cell").nth(0).click();
    await pageB.waitForFunction(() => document.querySelectorAll(".cell.black").length === 1);
    await pageB.locator(".cell").nth(25).click();
    await pageA.waitForFunction(() => document.querySelectorAll(".cell.white").length === 1);

    await pageA.click("#undoBtn");
    await pageB.waitForFunction(() => !document.querySelector("#undoAcceptBtn")?.disabled);
    await pageB.click("#undoAcceptBtn");
    await pageA.waitForFunction(() => document.querySelectorAll(".cell.white").length === 0);
    await pageB.waitForFunction(() => document.querySelectorAll(".cell.white").length === 0);

    const result = {
      roomCode,
      invite: await pageA.locator("#inviteLinkInput").inputValue(),
      blackA: await pageA.locator(".cell.black").count(),
      whiteA: await pageA.locator(".cell.white").count(),
      blackB: await pageB.locator(".cell.black").count(),
      whiteB: await pageB.locator(".cell.white").count(),
      statusA: await pageA.locator("#statusText").innerText(),
      statusB: await pageB.locator("#statusText").innerText()
    };

    await browser.close();
    console.log(JSON.stringify({ ok: true, result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error), stdout, stderr }, null, 2));
    process.exitCode = 1;
  } finally {
    server.kill("SIGINT");
  }
}

runSmoke();
