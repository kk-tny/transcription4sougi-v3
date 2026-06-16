import express from "express";
import { google } from "googleapis";
import cors from "cors";
import axios from "axios";
import { GoogleGenAI, Type } from "@google/genai";

import { analyzeAudioServer } from "../services/geminiService.ts";
import { fetchMasterData } from "../services/autoAnalysisService.ts";

const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' }));

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

app.post("/api/analyze", async (req, res) => {
  try {
    const { audioData, accountName } = req.body;
    let staffList: string[] = [];
    let customMasters: any[] = [];

    if (accountName) {
      try {
        const { staffMap, customMasterMap } = await fetchMasterData();
        staffList = staffMap.get(accountName) || [];
        customMasters = customMasterMap.get(accountName) || [];
        console.log(`[DEBUG] Dynamic master loaded for user-driven analysis (Account: "${accountName}"):`, {
          staffCount: staffList.length,
          customMasterCount: customMasters.length
        });
      } catch (masterError: any) {
        console.warn(`[WARNING] Failed to load master data for manual analysis (Account: "${accountName}"):`, masterError.message);
      }
    }

    const result = await analyzeAudioServer(audioData, staffList, customMasters);
    res.json({ text: JSON.stringify(result) }); // フロントエンド側は text プロパティ内の JSON をパースする作りになっているため
  } catch (error: any) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sheets/data", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "シート1!A4:H" });
    res.json({ values: response.data.values || [] });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/sheets/update-row", async (req, res) => {
  try {
    const { rowIndex, data } = req.body;
    console.log(`Writing at index ${rowIndex}...`);
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    // 内容が配列なら結合し、文字列ならそのまま使う (一括処理のエラー対策)
    const formatValue = (val: any, joiner: string = '\n') => {
      if (Array.isArray(val)) {
        return val.join(joiner);
      }
      return val || "";
    };

    const values = [[
      data.callerName || "",
      data.subjectName || "",
      data.inquiryType || "",
      formatValue(data.details),
      formatValue(data.responderNames, '　→　')
    ]];

    const actualRow = rowIndex + 4;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `シート1!C${actualRow}:G${actualRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });

    console.log("Success!");
    res.json({ success: true });
  } catch (error: any) {
    console.error("Sheets Update Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/proxy-audio", async (req, res) => {
  try {
    const url = req.query.url as string;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
  } catch (error: any) { res.status(500).send(error.message); }
});

export default app;
