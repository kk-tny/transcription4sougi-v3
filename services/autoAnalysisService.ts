import { google } from "googleapis";
import axios from "axios";
import { getCdbAuthToken, getCallLogs, CdbCallLog } from "./cdbService.ts";
import { analyzeAudioServer } from "./geminiService.ts";
import { sendChatworkNotification } from "./chatworkService.ts";

// Google Sheets クライアントの初期化
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

async function fetchAudioAsBase64(url: string): Promise<{ data: string, mimeType: string }> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data, 'binary');
  return {
    data: buffer.toString('base64'),
    mimeType: response.headers['content-type'] || 'audio/mpeg'
  };
}

export async function runAutoAnalysis() {
  console.log("Starting Auto Analysis task...");
  let successCount = 0;
  let errorCount = 0;

  try {
    // 1. CDBから前日分のログを取得
    const token = await getCdbAuthToken();
    const now = new Date();
    
    // Asia/Tokyo タイムゾーンで現在の日付をロバストに取得するフォーマッタ
    const tokyoFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    
    // 本日のJST日付を取得する
    const tokyoParts = tokyoFormatter.formatToParts(now);
    const yearStr = tokyoParts.find(p => p.type === 'year')?.value || '';
    const monthStr = tokyoParts.find(p => p.type === 'month')?.value || '';
    const dayStr = tokyoParts.find(p => p.type === 'day')?.value || '';
    
    // 本日のJST 00:00:00日時のインスタンスを作成
    const todayJst = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00+09:00`);
    
    // 本日から12時間差し引いて、確実にJST「前日」の日中の時刻を取得
    const yesterdayMiddayJst = new Date(todayJst.getTime() - 12 * 60 * 60 * 1000);
    const yesterdayParts = tokyoFormatter.formatToParts(yesterdayMiddayJst);
    const yYear = yesterdayParts.find(p => p.type === 'year')?.value || '';
    const yMonth = yesterdayParts.find(p => p.type === 'month')?.value || '';
    const yDay = yesterdayParts.find(p => p.type === 'day')?.value || '';
    const dateStr = `${yYear}-${yMonth}-${yDay}`; // YYYY-MM-DD (JST昨日)
    
    console.log(`[DEBUG] Current UTC Time: ${now.toISOString()}`);
    console.log(`[DEBUG] Current JST Date: ${yearStr}-${monthStr}-${dayStr}`);
    console.log(`[DEBUG] Calculated dateStr (yesterday JST): ${dateStr}`);
    
    // 取得範囲（前日の0:00:00〜23:59:59）
    const startDate = `${dateStr} 00:00:00`;
    const endDate = `${dateStr} 23:59:59`;
    
    console.log(`Fetching logs from ${startDate} to ${endDate}...`);
    const logs = await getCallLogs(token, startDate, endDate);
    console.log(`Found ${logs.length} logs.`);

    if (logs.length === 0) {
      console.log("No logs to process.");
      return;
    }

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.AUTO_ANALYSIS_SPREADSHEET_ID || process.env.SPREADSHEET_ID;

    for (const log of logs) {
      try {
        console.log(`Processing log for ${log.call_at}...`);
        
        // 2. 音声を解析
        let analysis: any = null;
        if (log.audio_url) {
          const audio = await fetchAudioAsBase64(log.audio_url);
          analysis = await analyzeAudioServer(audio);
        }

        // 3. スプレッドシートに書き込み
        const values = [[
          log.account_name || "",
          log.campaign_name || "",
          log.call_at || "",
          log.observation_point_name || "",
          log.duration || 0,
          log.caller_number || "",
          log.media_number || "",
          log.termination_reason || "",
          log.audio_url || "",
          analysis?.callerName || "解析不能",
          analysis?.subjectName || "解析不能",
          analysis?.responderNames?.join('　→　') || "解析不能",
          analysis?.inquiryType || "解析不能",
          analysis?.details?.join('\n') || "解析不能"
        ]];

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "シート1!A:N", // シート名や範囲は必要に応じて調整
          valueInputOption: "RAW",
          requestBody: { values },
        });

        successCount++;
        console.log("Successfully processed and saved.");
      } catch (err) {
        console.error(`Error processing log:`, err);
        errorCount++;
      }
    }

    // 4. Chatwork通知
    await sendChatworkNotification(successCount, errorCount);
    console.log("Auto Analysis task finished.");

  } catch (error) {
    console.error("Critical error in Auto Analysis task:", error);
    await sendChatworkNotification(0, 1); // 致命的なエラー時も通知
  }
}
