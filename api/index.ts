import express from "express";
import { google } from "googleapis";
import cors from "cors";
import axios from "axios";
import { GoogleGenAI } from "@google/genai"; // 追加

const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' })); // 容量を大きく

// Google Sheets Auth Helper
const getSheetsClient = () => {
  const jsonKey = process.env.GOOGLE_SHEETS_JSON_KEY;
  if (!jsonKey) throw new Error("GOOGLE_SHEETS_JSON_KEY is not set");
  const credentials = JSON.parse(jsonKey);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
};

// --- API Routes ---

// Gemini解析プロキシ
app.post("/api/analyze", async (req, res) => {
  try {
    const { audioData } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set on server");

    const genAI = new GoogleGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 元々の Gemini への指示文
    const prompt = `あなたは葬儀社のベテラン事務スタッフです。添付された音声を解析して、指定の形式で出力してください。`;

    const result = await model.generateContent([
      { inlineData: audioData },
      prompt
    ]);

    // 解析結果のテキストをそのまま返す
    res.json({ text: result.response.text() });
  } catch (error: any) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// スプレッドシートデータの取得
app.get("/api/sheets/data", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "シート1!A4:G",
    });
    res.json({ values: response.data.values || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// スプレッドシートへの書き込み
app.post("/api/sheets/update-row", async (req, res) => {
  try {
    const { rowIndex, data } = req.body;
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const values = [[data.callerName, data.subjectName, data.inquiryType, data.details, data.responderNames]];
    const actualRow = rowIndex + 4;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `シート1!B${actualRow}:F${actualRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 音源プロキシ
app.get("/api/proxy-audio", async (req, res) => {
  try {
    const url = req.query.url as string;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});

export default app;
