import express from "express";
import { google } from "googleapis";
import cors from "cors";
import axios from "axios";

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Google Sheets Auth Helper
const getSheetsClient = () => {
  const jsonKey = process.env.GOOGLE_SHEETS_JSON_KEY;
  if (!jsonKey) {
    throw new Error("GOOGLE_SHEETS_JSON_KEY is not set");
  }
  const credentials = JSON.parse(jsonKey);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
};

// --- API Routes ---

// スプレッドシートのデータを取得 (G列のURLリストなど)
app.get("/api/sheets/data", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "シート1!A4:G", // 4行目からG列まで取得
    });

    res.json({ values: response.data.values || [] });
  } catch (error: any) {
    console.error("Sheets API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 解析結果をスプレッドシートに書き込む
app.post("/api/sheets/update-row", async (req, res) => {
  try {
    const { rowIndex, data } = req.body; // rowIndexは4行目を0としたインデックス
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;

    // B列〜F列に書き込む (インデックス1〜5)
    // B: ご相談者様名, C: ご対象者様名, D: 問い合わせの種類, E: 具体的な内容, F: 応対者名
    const values = [[
      data.callerName,
      data.subjectName,
      data.inquiryType,
      data.details,
      data.responderNames
    ]];

    const actualRow = rowIndex + 4; // スプレッドシート上の実際の行番号
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `シート1!B${actualRow}:F${actualRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Sheets API Update Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 音源URLからデータを取得するためのプロキシ (CORS対策)
app.get("/api/proxy-audio", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).send("URL is required");

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'];
    
    res.set('Content-Type', contentType);
    res.send(response.data);
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});

export default app;
