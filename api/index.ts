import express from "express";
import { google } from "googleapis";
import cors from "cors";
import axios from "axios";
import { GoogleGenAI, Type } from "@google/genai";

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
    console.log(`Debug: GEMINI_API_KEY length: ${apiKey?.length}`);
    if (apiKey) {
      console.log(`Debug: Starts with: ${apiKey.substring(0, 4)}... Ends with: ...${apiKey.substring(apiKey.length - 4)}`);
    }
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set on server");

    const ai = new GoogleGenAI({ apiKey });

    // Vercel 時代のプロンプトを完全に復元
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash", 
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: audioData.data, mimeType: audioData.mimeType } },
            { text: "葬儀社に掛かってきた電話の音声を解析し、指定されたフォーマットで情報を抽出してください。特に名前は必ず「ひらがな」で抽出してください。" }
          ]
        }
      ],
      config: {
        systemInstruction: `あなたは葬儀社の熟練事務スタッフです。葬儀社宛の電話内容を正確に解析し、以下の項目を抽出してください。

1. ご相談者様名: 電話をしてきた人の名前。必ず「ひらがな」で抽出してください。不明な場合は「不明」としてください。
2. ご対象者様名: 亡くなられた方の名前。必ず「ひらがな」で抽出してください。不明な場合は「不明」としてください。
3. 応対者名: 電話を受けた葬儀社側のスタッフ名。必ず「ひらがな」で抽出してください。音声内で名乗らなかったため名前がわからない場合は、必ず「不明（名乗らず）」という文字列を出力してください（「ふめい（なのらず）」などの表記揺れは禁止です）。複数いる場合、電話を受けた順番（会話に登場した順）にリスト形式で抽出してください。
4. 問い合わせの種類: 以下の定義に基づき、最も適切なものを1つ選んでください。
   - 訃報: 家族や身内が亡くなった状況での葬儀相談
   - 事前相談: 家族や身内でもうすぐ亡くなる可能性がある方の葬儀相談
   - 自身の事前相談: 電話をしてきた人本人が、将来自分自身が亡くなった時の葬儀を検討している相談
   - 参列問い合わせ: 誰かの葬儀に参列するために、時間確認や会場への行き方を知りたい方からのお問合せ
   - 供花、供物の注文依頼: 誰かの葬儀に贈る葬儀の御花や供物の注文についてのお問合せ
   - 間違い電話（葬儀相談）: 自社以外の葬儀社 / 葬儀式場 / 葬儀会館と間違えたもののうち、「訃報」もしくは「事前相談」に該当する葬儀相談
   - 間違い電話（葬儀相談以外）: 自社以外の葬儀社 / 葬儀式場 / 葬儀会館と間違えたもののうち、「訃報」もしくは「事前相談」以外のお問い合わせ
   - 間違い電話（葬儀社以外宛）: 葬儀社 / 葬儀式場 / 葬儀会館とは関係のない場所と間違えたもの
   - その他: 上記に該当しない内容のお問合せ
5. 具体的な内容: 電話の内容を簡潔にまとめてください。出力形式は「・」で始まる箇条書き（Array形式）とし、各要素の冒頭には必ず「・」を含めてください。
6. 文字起こし: 全ての会話を話者ごとに正確に記録してください。`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            callerName: { type: Type.STRING },
            subjectName: { type: Type.STRING },
            responderNames: { type: Type.ARRAY, items: { type: Type.STRING } },
            inquiryType: { 
              type: Type.STRING,
              enum: ['訃報', '事前相談', '自身の事前相談', '参列問い合わせ', '供花、供物の注文依頼', '間違い電話（葬儀相談）', '間違い電話（葬儀相談以外）', '間違い電話（葬儀社以外宛）', 'その他']
            },
            details: { type: Type.ARRAY, items: { type: Type.STRING } },
            transcription: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { speaker: { type: Type.STRING }, transcript: { type: Type.STRING } },
                required: ["speaker", "transcript"]
              }
            }
          },
          required: ["callerName", "subjectName", "responderNames", "inquiryType", "details", "transcription"]
        }
      }
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: error.message });
  }
});

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
      range: `シート1!B${actualRow}:F${actualRow}`,
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
