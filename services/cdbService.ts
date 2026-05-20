import axios from 'axios';

export interface CdbCallLog {
  account_name: string;
  campaign_name: string;
  call_at: string;
  observation_point_name: string;
  duration: number;
  caller_number: string;
  media_number: string;
  termination_reason: string;
  audio_url: string;
}

export async function getCdbAuthToken(): Promise<string> {
  const email = process.env.CDB_EMAIL;
  const password = process.env.CDB_PASSWORD;
  const sid = process.env.CDB_SERVICE_CONSUMER_ID || '1';

  if (!email || !password) {
    throw new Error('CDB_EMAIL or CDB_PASSWORD is not set in environment variables');
  }

  const response = await axios.post('https://api-2.omni-databank.com/authentications', {
    sid,
    email,
    password
  });

  if (!response.data || !response.data.accessToken) {
    throw new Error('Failed to get authentication token from CDB API. Verify sid, email, and password.');
  }

  return response.data.accessToken;
}

export async function getCallLogs(token: string, startDate: string, endDate: string): Promise<CdbCallLog[]> {
  const sid = process.env.CDB_SERVICE_CONSUMER_ID || '1';

  // 1. /me エンドポイントから所属・管理しているアカウント情報一覧を動的に取得
  let uniqueAccounts = new Map<number, string>();
  try {
    const meResponse = await axios.get('https://api-2.omni-databank.com/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'ServiceConsumerID': sid
      }
    });

    console.log('--- [DEBUG] CDB /me response successfully retrieved ---');
    
    // belongs（所属アカウント）のパース
    if (meResponse.data.belongs && Array.isArray(meResponse.data.belongs)) {
      for (const b of meResponse.data.belongs) {
        if (b.accountId) {
          uniqueAccounts.set(Number(b.accountId), b.label || `Account ${b.accountId}`);
        }
      }
    }

    // accounts（管理アカウント）のパース
    if (meResponse.data.accounts && Array.isArray(meResponse.data.accounts)) {
      for (const a of meResponse.data.accounts) {
        if (a.accountId) {
          uniqueAccounts.set(Number(a.accountId), a.label || `Account ${a.accountId}`);
        }
      }
    }

    console.log(`[DEBUG] Detected accounts size: ${uniqueAccounts.size}`);
  } catch (meError: any) {
    console.error('--- [DEBUG] Failed to get /me info. Fallback to default behavior constraint. ---');
    console.error(meError.response?.data || meError.message);
  }

  // 日付形式を YYYY-MM-DD に統一（HH:mm:ss が不要な可能性があるため）
  const since = startDate.split(' ')[0];
  const until = endDate.split(' ')[0];

  const allCallLogs: CdbCallLog[] = [];

  // アカウント情報が取得できなかった場合のフォールバック（従来通りアカウントID指定なしで1回リクエスト）
  if (uniqueAccounts.size === 0) {
    console.log(`--- [DEBUG] Requesting CDB logs without accountId: since=${since}, until=${until}, sid=${sid} ---`);
    try {
      const response = await axios.get('https://api-2.omni-databank.com/behaviors/phone/calls', {
        params: { since, until },
        headers: {
          'Authorization': `Bearer ${token}`,
          'ServiceConsumerID': sid
        }
      });
      const logs = response.data._embedded?.calls || response.data || [];
      if (Array.isArray(logs)) {
        for (const log of logs) {
          allCallLogs.push({
            account_name: log.account_name || '不明なアカウント',
            campaign_name: log.campaign_name || '',
            call_at: log.call_at || '',
            observation_point_name: log.observation_point_name || '',
            duration: log.duration || 0,
            caller_number: log.caller_number || '',
            media_number: log.media_number || '',
            termination_reason: log.termination_reason || '',
            audio_url: log.audio_url || ''
          });
        }
      }
    } catch (error: any) {
      console.error('--- [DEBUG] CDB API Error (Fallback) ---');
      console.error(error.response?.data || error.message);
      throw error;
    }
    return allCallLogs;
  }

  // 2. 収集した各アカウントごとにクエリパラメータにて accountId を指定して入電ログを取得
  for (const [accountId, accountName] of uniqueAccounts.entries()) {
    console.log(`--- [DEBUG] Requesting CDB logs: accountId=${accountId} (${accountName}), since=${since}, until=${until}, sid=${sid} ---`);
    try {
      const response = await axios.get('https://api-2.omni-databank.com/behaviors/phone/calls', {
        params: { since, until, accountId },
        headers: {
          'Authorization': `Bearer ${token}`,
          'ServiceConsumerID': sid
        }
      });

      console.log(`--- [DEBUG] CDB API response status for ${accountName}:`, response.status);

      const logs = response.data._embedded?.calls || response.data || [];
      if (Array.isArray(logs)) {
        for (const log of logs) {
          allCallLogs.push({
            account_name: log.account_name || accountName, // ログ側になければmeから得られた名前を上書き/フォールバック
            campaign_name: log.campaign_name || '',
            call_at: log.call_at || '',
            observation_point_name: log.observation_point_name || '',
            duration: log.duration || 0,
            caller_number: log.caller_number || '',
            media_number: log.media_number || '',
            termination_reason: log.termination_reason || '',
            audio_url: log.audio_url || ''
          });
        }
      }
    } catch (error: any) {
      console.error(`--- [DEBUG] CDB API Error for Account ${accountName} (ID: ${accountId}) ---`);
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('Message:', error.message);
      }
      // 他のアカウントで通話ログが正常に取れる可能性を考慮し、エラーが発生してもスキップして続行します。
    }
  }

  console.log(`--- [DEBUG] All accounts processing completed. Total combined call logs: ${allCallLogs.length} ---`);
  return allCallLogs;
}
