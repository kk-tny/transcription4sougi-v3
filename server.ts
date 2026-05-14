import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cron from "node-cron";
import app from "./api/index";
import { runAutoAnalysis } from "./services/autoAnalysisService";

async function startServer() {
  const PORT = process.env.PORT || 3000;

  // --- Cron Job (Every day at 4:00 AM) ---
  cron.schedule("0 4 * * *", async () => {
    console.log("Cron job triggered: runAutoAnalysis at 4:00 AM");
    try {
      await runAutoAnalysis();
    } catch (err) {
      console.error("Failed to run scheduled auto analysis:", err);
    }
  });

  // 手動実行・Cloud Scheduler 用のトリガーエンドポイント
  app.get("/api/admin/trigger-auto-analysis", async (req, res) => {
    const token = req.query.token;
    const expectedToken = process.env.TRIGGER_TOKEN;

    if (!expectedToken || token !== expectedToken) {
      console.warn("Unauthorized trigger attempt with invalid token.");
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("Auto analysis triggered via API endpoint.");
    runAutoAnalysis(); // 非同期で実行（レスポンスを待たせない）
    res.json({ message: "Started auto analysis task in background." });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
