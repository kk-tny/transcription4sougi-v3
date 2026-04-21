import express from "express";
import { google } from "googleapis";
import cors from "cors";
import axios from "axios";
import { GoogleGenAI, Type } from "@google/genai"; // Type を追加

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
    const { audioData } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set on server");

    const ai = new GoogleGenAI({ apiKey });

    // AIへの厳密な指示文と出力スキーマの定義
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: audioData.data, mimeType: audioData.mimeType } },
            { text: `葬儀社の受付として、音声の内容を正確に抽出し、以下のJSON形式で回答してください。
            
{
  "callerName": "ご相談者様の名前。不明な場合は「不明」",
  "subjectName": "ご対象者（故人様）の名前。不明な場合は「不明」",
  "responderNames": ["応対したスタッフの名前を配列で"],
  "inquiryType": "問い合わせの種類（例：搬送依頼、事前相談、訃報連絡等）",
  "details": ["具体的な内容の要点を箇条書きの配列で"],
  "transcription": [
    { "speaker": "話者名", "transcript": "話した内容" }
  ]
}` }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json", // JSONで返すよう強制
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            callerName: { type: Type.STRING },
            subjectName: { type: Type.STRING },
            responderNames: { type: Type.ARRAY, items: { type: Type.STRING } },
            inquiryType: { type: Type.STRING },
            details: { type: Type.ARRAY, items: { type: Type.STRING } },
            transcription: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speaker: { type: Type.STRING },
                  transcript: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// (以下、sheets/data, update-row, proxy-audio は前回と同じ)
app.get("/api/sheets/data", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "シート1!A4:G" });
    res.json({ values: response.data.values || [] });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/sheets/update-row", async (req, res) => {
  try {
    const { rowIndex, data } = req.body;
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    // 配列の結合処理が含まれているか確認
    const values = [[
      data.callerName,
      data.subjectName,
      data.inquiryType,
      data.details,
      data.responderNames
    ]];
    const actualRow = rowIndex + 4;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `シート1!B${actualRow}:F${actualRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
