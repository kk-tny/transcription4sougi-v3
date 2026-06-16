import { google } from "googleapis";
import axios from "axios";
import { getCdbAuthToken, getCallLogs, CdbCallLog } from "./cdbService.ts";
import { analyzeAudioServer, CustomMaster } from "./geminiService.ts";
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

function formatCallAtToJst(callAtStr: string): string {
  if (!callAtStr) return "";
  try {
    const d = new Date(callAtStr);
    if (isNaN(d.getTime())) return callAtStr;
    
    // 時差(JST = UTC + 9)を考慮してミリ秒を計算し、コンテナ（UTC環境など）に関わらず確実にJST時間基準で取得します
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstTime = new Date(d.getTime() + jstOffset);
    
    const year = jstTime.getUTCFullYear();
    const month = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(jstTime.getUTCDate()).padStart(2, '0');
    const hour = String(jstTime.getUTCHours()).padStart(2, '0');
    const minute = String(jstTime.getUTCMinutes()).padStart(2, '0');
    const second = String(jstTime.getUTCSeconds()).padStart(2, '0');
    
    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
  } catch (e) {
    return callAtStr;
  }
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

export async function fetchMasterData(): Promise<{
  staffMap: Map<string, string[]>;
  customMasterMap: Map<string, CustomMaster[]>;
}> {
  const staffMap = new Map<string, string[]>();
  const customMasterMap = new Map<string, CustomMaster[]>();

  try {
    console.log("Fetching master data map (Staff & Names) from Sheet 'アカウントとスタッフ'...");
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.AUTO_ANALYSIS_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
    
    // スプレッドシートから「アカウントとスタッフ」のデータをA列からD列まで広範囲で取得
    const response = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "アカウントとスタッフ!A:D",
    }));
    
    const rows = response.data.values || [];
    if (rows.length > 1) {
      const headerRow = rows[0].map(h => String(h).trim());
      // 分類カラムと読み方カラムが存在するかで新フォーマットかどうかを判定
      const hasCategoryCol = headerRow.includes("分類");
      const hasReadingCol = headerRow.includes("読み方（ひらがな）");
      
      if (hasCategoryCol && hasReadingCol) {
        // 新フォーマット：アカウント名 / 分類 / 正式名称(漢字/英語) / 読み方(ひらがな)
        console.log("[DEBUG] Detected NEW 4-column master data format in Google Sheet.");
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 2) continue;
          
          const accountName = String(row[0] || "").trim();
          const category = String(row[1] || "").trim();
          const formalName = String(row[2] || "").trim();
          const reading = String(row[3] || "").trim();
          
          if (!accountName) continue;
          
          if (category === "スタッフ名") {
            // スタッフ名の場合（読み方ひらがなをスタッフ名として採用）
            const staffName = reading || formalName; // 基本は読み方のひらがなをマッピング
            if (staffName) {
              if (!staffMap.has(accountName)) {
                staffMap.set(accountName, []);
              }
              staffMap.get(accountName)!.push(staffName);
            }
          } else {
            // その他の分類（葬儀式場名、火葬場名、屋号など）
            if (reading && formalName) {
              if (!customMasterMap.has(accountName)) {
                customMasterMap.set(accountName, []);
              }
              customMasterMap.get(accountName)!.push({
                category,
                formalName,
                reading
              });
            }
          }
        }
      } else {
        // 旧フォーマット：アカウント名 / スタッフ名 (2カラムのみ)
        console.log("[DEBUG] Detected OLD 2-column master data format in Google Sheet. Doing fallback parsing.");
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 2) continue;
          const accountName = String(row[0] || "").trim();
          const staffName = String(row[1] || "").trim();
          if (accountName && staffName) {
            if (!staffMap.has(accountName)) {
              staffMap.set(accountName, []);
            }
            staffMap.get(accountName)!.push(staffName);
          }
        }
      }
      
      console.log(`[DEBUG] Successfully loaded masters for ${staffMap.size} accounts (staff lists) and ${customMasterMap.size} accounts (custom masters).`);
    } else {
      console.log("[DEBUG] Sheet 'アカウントとスタッフ' is empty or only contains header.");
    }
  } catch (error: any) {
    console.warn("--- [WARNING] Failed to load staff/custom list. Proceeding with generic fallback analysis. ---", error.message);
  }
  
  return { staffMap, customMasterMap };
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

    // アカウントごとのマスターデータをロード
    const { staffMap, customMasterMap } = unprocessedLogs.length > 0 
      ? await fetchMasterData() 
      : { staffMap: new Map<string, string[]>(), customMasterMap: new Map<string, CustomMaster[]>() };

    if (unprocessedLogs.length > 0) {
      for (const log of unprocessedLogs) {
        try {
          console.log(`Processing log for ${log.call_at}...`);
          
          // 2. 音声を解析
          let analysis: any = null;
          if (log.audio_url) {
            const audio = await fetchAudioAsBase64(log.audio_url);
            const accountName = log.account_name || "";
            const staffList = staffMap.get(accountName) || [];
            const customMasters = customMasterMap.get(accountName) || [];
            
            if (staffList.length > 0 || customMasters.length > 0) {
              console.log(`[DEBUG] Master data loaded for account "${accountName}":`, {
                staffCount: staffList.length,
                customMasterCount: customMasters.length
              });
            } else {
              console.log(`[DEBUG] No custom master data registered for account "${accountName}". Using generic rules.`);
            }
            analysis = await analyzeAudioServer(audio, staffList, customMasters);
          }

          // 3. スプレッドシート用の値を準備
          const rowValues = [
            log.account_name || "",
            log.campaign_name || "",
            formatCallAtToJst(log.call_at || ""),
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

          // 各ログの完了ごとにスプレッドシートへの即時書き込みを行います
          // これにより、たとえ実行タイムアウト等が発生しても処理が完了したログは確実に保存され、
          // 次回実行時には重複確認（existingCallIds）によって二重の処理を防ぐことができます。
          await withRetry(() => sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "シート1!A:O",
            valueInputOption: "RAW",
            requestBody: { values: [rowValues] },
          }));

          successCount++;
          console.log(`Successfully processed and saved call ${log.call_id} to Sheet.`);
        } catch (err) {
          console.error(`Error processing log:`, err);
          errorCount++;
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
