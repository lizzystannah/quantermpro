import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import Redis from "ioredis";
import { createServer } from "http";
import { Server } from "socket.io";
import { initServerEngine, startRobotOnServer, stopRobotOnServer } from "./src/lib/serverEngine.ts";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  
  initServerEngine(io);
  const PORT = 3000;

  app.use(express.json());

  // WebSocket Logic for Server-Side Robots
  io.on("connection", (socket) => {
    console.log("Client connected to WebSocket:", socket.id);

    socket.on("start-robot", async ({ config, token }) => {
       console.log("Starting robot on server:", config.id);
       await startRobotOnServer(config, token, socket);
    });

    socket.on("stop-robot", async (id) => {
       console.log("Stopping robot on server:", id);
       await stopRobotOnServer(id);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // API router
  console.log("Defining POST /api/strategies");
  app.post("/api/strategies", (req, res) => {
    const { id, code } = req.body;
    if (!id || !code) {
      return res.status(400).json({ error: "Missing id or code" });
    }
    
    // Ensure valid filename
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeId) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const targetPath = path.join(process.cwd(), "src", "strategies", `${safeId}.ts`);
    try {
      fs.writeFileSync(targetPath, code, "utf-8");
      res.json({ success: true, message: "Strategy saved" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Failed to save strategy: " + msg });
    }
  });

  console.log("Defining POST /api/redis/fetch");
  app.post("/api/redis/fetch", async (req, res) => {
    const { host, port, key, password, asset } = req.body;
    
    const p = parseInt(port || "6379");
    if (isNaN(p)) {
      return res.status(400).json({ error: "Invalid port number" });
    }

    let redis: Redis | null = null;
    try {
      redis = new Redis({
        host: host || "127.0.0.1",
        port: p,
        password: password || undefined,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      });

      redis.on('error', (err) => {
        console.error('Redis background connection error:', err);
      });

      let result;
      if (asset === "ALL") {
         const keys = await redis.keys("backtestvelas:*");
         const allData: Record<string, unknown> = {};
         for (const k of keys) {
           const data = await redis.get(k);
           if (data) allData[k] = JSON.parse(data);
         }
         result = allData;
      } else {
         const data = await redis.get(key);
         result = data ? JSON.parse(data) : null;
      }
      await redis.quit();
      res.json({ success: true, data: result });
    } catch (err: unknown) {
       console.error("Failed to fetch from redis:", err);
       if (redis) redis.disconnect();
       res.status(500).json({ error: String(err) });
    }
  });

  // Serve strategies list so the UI knows which files exist
  console.log("Defining GET /api/strategies");
  app.get("/api/strategies", (req, res) => {
    try {
      const stratDir = path.join(process.cwd(), "src", "strategies");
      let files: string[] = [];
      if (fs.existsSync(stratDir)) {
         files = fs.readdirSync(stratDir).filter(f => f.endsWith('.ts') && f !== 'index.ts');
      }
      res.json({ files });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to read strategies" });
    }
  });

  console.log("Defining DELETE /api/strategies/:id");
  app.get("/api/strategies/:id", (req, res) => {
    const { id } = req.params;
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeId) return res.status(400).json({ error: "Invalid ID" });

    const targetPath = path.join(process.cwd(), "src", "strategies", `${safeId}.ts`);
    try {
      if (fs.existsSync(targetPath)) {
        const code = fs.readFileSync(targetPath, "utf-8");
        res.json({ code });
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to read strategy file" });
    }
  });

  app.delete("/api/strategies/:id", (req, res) => {
    const { id } = req.params;
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeId) return res.status(400).json({ error: "Invalid ID" });

    const targetPath = path.join(process.cwd(), "src", "strategies", `${safeId}.ts`);
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Failed to delete: " + msg });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    console.log("Defining GET *all");
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
