import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import app from "./api/index.ts";
import { runAutoAnalysis } from "./services/autoAnalysisService.ts";

async function startServer() {
  const PORT = process.env.PORT || 3000;

  // --- Cron Job は削除しました (Cloud Scheduler でトリガーするため) ---

  // 手動実行・Cloud Scheduler 用のトリガーエンドポイント
  app.get("/api/admin/trigger-auto-analysis", async (req, res) => {
    const token = req.query.token;
    const expectedToken = process.env.TRIGGER_TOKEN;

    if (!expectedToken) {
      console.error("TRIGGER_TOKEN is not set in environment variables.");
      return res.status(401).json({ error: "Configuration Error: TRIGGER_TOKEN is missing." });
    }

    if (token !== expectedToken) {
      console.warn(`Unauthorized trigger attempt. Received: "${token}", but expected a different value.`);
      return res.status(401).json({ error: "Unauthorized: Token mismatch." });
    }

    console.log("Auto analysis triggered successfully via API endpoint.");
    // Cloud Run でバックグラウンド非同期処理を行うと、レスポンス返却後に CPU が停止されて処理がフリーズするため、
    // await して HTTP リクエスト処理期間中にすべての解析・保存を実行します。
    try {
      await runAutoAnalysis();
      res.json({ message: "Auto analysis task completed successfully." });
    } catch (err: any) {
      console.error("Critical error in triggered auto-analysis execution:", err);
      res.status(500).json({ error: "Failed to complete auto analysis task: " + err.message });
    }
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
