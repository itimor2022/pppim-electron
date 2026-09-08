import express from "express";
import { join } from "path";
import type { Server } from "http";

let server: Server | null = null;
let serverPort = 0;

export function startLocalServer(
  distPath: string,
  extraResourcesPath: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(serverPort);
      return;
    }

    const app = express();

    app.use(
      "/twemoji",
      express.static(join(extraResourcesPath, "twemoji"), {
        setHeaders: (res) => {
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        },
      }),
    );
    
    // 请求日志
    app.use((req, res, next) => {
      console.log(`[LocalServer] ${req.method} ${req.url}`);
      next();
    });
    
    // 静态文件服务
    app.use(express.static(distPath, {
      setHeaders: (res, path) => {
        console.log(`[LocalServer] Serving static file: ${path}`);
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
    }));

    // 随机端口启动
    server = app.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (address && typeof address === "object") {
        serverPort = address.port;
        console.log(`[LocalServer] Started on http://127.0.0.1:${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error("Failed to get server port"));
      }
    });

    server.on("error", (err) => {
      console.error("[LocalServer] Error:", err);
      reject(err);
    });
  });
}

export function stopLocalServer() {
  if (server) {
    server.close();
    server = null;
    serverPort = 0;
    console.log("[LocalServer] Stopped");
  }
}
