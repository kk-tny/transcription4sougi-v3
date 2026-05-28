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

// 外部APIやGoogleスプレッドシートAPIなどエラーが起きやすい処理のリトライフ処理用のヘルパー
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 2000): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        throw error;
      }
      console.warn(`[WARNING] Attempt ${attempt} failed, retrying in ${delayMs}ms... Error:`, error);
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
    }
  }
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
    
    // 本日から24時間（1日）差し引いて、確実にJST「前日（昨日）」の日付を取得
    const yesterdayJst = new Date(todayJst.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayParts = tokyoFormatter.formatToParts(yesterdayJst);
    const yYear = yesterdayParts.find(p => p.type === 'year')?.value || '';
    const yMonth = yesterdayParts.find(p => p.type === 'month')?.value || '';
    const yDay = yesterdayParts.find(p => p.type === 'day')?.value || '';
    
    const dateStr = `${yYear}-${yMonth}-${yDay}`; // YYYY-MM-DD (JST昨日)
    
    console.log(`[DEBUG] Current UTC Time: ${now.toISOString()}`);
    console.log(`[DEBUG] Current JST Date: ${yearStr}-${monthStr}-${dayStr}`);
    console.log(`[DEBUG] Calculated dateStr (yesterday JST): ${dateStr}`);
    
    const startDate = `${dateStr} 00:00:00`;
    const endDate = `${dateStr} 23:59:59`;
    
    console.log(`Fetching logs from ${startDate} to ${endDate}...`);
    const logs = await getCallLogs(token, startDate, endDate);
    console.log(`Found ${logs.length} logs in CDB API.`);

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.AUTO_ANALYSIS_SPREADSHEET_ID || process.env.SPREADSHEET_ID;

    // 重複防止：既存のコールID（15列目：O列）をシートから読み出す
    let existingCallIds = new Set<string>();
    try {
      const existingResponse = await withRetry(() => sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "シート1!O:O",
      }));
      const rows = existingResponse.data.values || [];
      for (const row of rows) {
        if (row[0]) {
          existingCallIds.add(String(row[0]).trim());
        }
      }
      console.log(`--- [DEBUG] Fetched ${existingCallIds.size} existing call IDs from Sheet ---`);
    } catch (sheetError: any) {
      console.warn("--- [WARNING] Could not fetch existing call IDs. Assuming empty. ---", sheetError.message);
    }

    // 新しい（未処理の）ログのみにフィルタ
    const unprocessedLogs = logs.filter(log => log.call_id && !existingCallIds.has(log.call_id));
    console.log(`Unprocessed logs to analyze: ${unprocessedLogs.length} (out of ${logs.length} found)`);

    if (unprocessedLogs.length > 0) {
      const successRows: any[][] = [];
      for (const log of unprocessedLogs) {
        try {
          console.log(`Processing log for ${log.call_at}...`);
          
          // 2. 音声を解析
          let analysis: any = null;
          if (log.audio_url) {
            const audio = await fetchAudioAsBase64(log.audio_url);
            analysis = await analyzeAudioServer(audio);
          }

          // 3. スプレッドシート用の値を準備して蓄積
          const rowValues = [
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
            analysis?.details?.join('\n') || "解析不能",
            log.call_id || ""
          ];
          successRows.push(rowValues);
          successCount++;
          console.log("Successfully analyzed log (buffered for append).");
        } catch (err) {
          console.error(`Error processing log:`, err);
          errorCount++;
        }
      }

      // すべての正常終了した行を一括で書き込み
      if (successRows.length > 0) {
        console.log(`Appending ${successRows.length} rows to spreadsheet in batch...`);
        try {
          await withRetry(() => sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "シート1!A:O",
            valueInputOption: "RAW",
            requestBody: { values: successRows },
          }));
          console.log("Batch append to spreadsheet completed successfully.");
        } catch (batchError) {
          console.error("Critical error: failed to batch append rows to spreadsheet:", batchError);
          // もしバッチ全体が失敗した場合は、エラー行数としてすべてを計上する
          errorCount += successRows.length;
          successCount -= successRows.length;
        }
      }
    } else {
      console.log("No new logs to process today. Skipping extraction loop.");
    }

    // 4. Chatwork通知 (件数が0件でも完了状況を知らせるために必ず送信)
    await sendChatworkNotification(successCount, errorCount);
    console.log("Auto Analysis task finished.");

  } catch (error) {
    console.error("Critical error in Auto Analysis task:", error);
    await sendChatworkNotification(0, 1); // 致命的なエラー時も通知
  }
}
