import axios from 'axios';

export interface CdbCallLog {
  call_id: string;
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

  // Parser that converts "YYYY-MM-DD HH:mm:ss" in JST to a Unix timestamp in seconds
  const parseJstToUnixSeconds = (dateStr: string): string => {
    // Replace spaces with 'T' to create valid Date parse format
    const formatted = dateStr.trim().replace(/\s+/, 'T');
    const isoString = formatted.includes('+') ? formatted : `${formatted}+09:00`;
    return String(Math.floor(new Date(isoString).getTime() / 1000));
  };

  const beginTimestamp = parseJstToUnixSeconds(startDate);
  const endTimestamp = parseJstToUnixSeconds(endDate);

  // 1. /me エンドポイントから所属・管理しているアカウント情報一覧を動的に取得
  let uniqueAccounts = new Map<number, string>();
  let campaignsList: any[] = [];

  try {
    const meResponse = await axios.get('https://api-2.omni-databank.com/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'ServiceConsumerID': sid
      }
    });

    console.log('--- [DEBUG] CDB /me response successfully retrieved ---');
    
    const embedded = meResponse.data?._embedded || {};
    const accountsList = embedded.accounts || meResponse.data?.accounts || [];
    campaignsList = embedded.campaigns || meResponse.data?.campaigns || [];

    // accounts（管理アカウント）のパース
    if (Array.isArray(accountsList)) {
      for (const a of accountsList) {
        if (a.accountId) {
          uniqueAccounts.set(Number(a.accountId), a.label || `Account ${a.accountId}`);
        }
      }
    }

    console.log(`[DEBUG] Detected accounts size: ${uniqueAccounts.size}, campaigns size: ${campaignsList.length}`);
  } catch (meError: any) {
    console.error('--- [DEBUG] Failed to get /me info. ---');
    console.error(meError.response?.data || meError.message);
  }

  const allCallLogs: CdbCallLog[] = [];

  // キャンペーン情報が取得できなかった場合
  if (campaignsList.length === 0) {
    console.warn('--- [WARNING] No campaigns detected from /me endpoint. Querying is impossible. ---');
    return [];
  }

  // 2. 各キャンペーンごとにクエリパラメータ（campaignId、beginTimestamp、endTimestamp）を指定して入電ログを取得
  for (const campaign of campaignsList) {
    const campaignId = campaign.campaignId;
    if (!campaignId) continue;

    const campaignName = campaign.label || `Campaign ${campaignId}`;
    const accountName = uniqueAccounts.get(Number(campaign.accountId)) || `Account ${campaign.accountId}`;

    console.log(`--- [DEBUG] Requesting CDB logs: Campaign=${campaignName} (ID=${campaignId}, Account=${accountName}), begin=${beginTimestamp}, end=${endTimestamp} ---`);
    try {
      const response = await axios.get('https://api-2.omni-databank.com/behaviors/phone/calls', {
        params: { 
          campaignId: String(campaignId),
          beginTimestamp, 
          endTimestamp
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'ServiceConsumerID': sid
        }
      });

      console.log(`--- [DEBUG] CDB API response status for Campaign ${campaignName}:`, response.status);

      const logs = response.data._embedded?.calls || response.data || [];
      if (Array.isArray(logs)) {
        for (const log of logs) {
          allCallLogs.push({
            call_id: log.callId || log.call_id || '',
            account_name: accountName,
            campaign_name: campaignName,
            call_at: log.calledAt || log.called_at || log.call_at || '',
            observation_point_name: log.observerLabel || log.observer_label || log.observation_point_name || '',
            duration: log.callDuration || log.call_duration || log.duration || 0,
            caller_number: log.callerPhoneNumber || log.caller_phone_number || log.caller_number || '',
            media_number: log.trackingPhoneNumber || log.tracking_phone_number || log.media_number || '',
            termination_reason: log.hangupCode !== undefined ? String(log.hangupCode) : log.termination_reason || '',
            audio_url: log.recordedAudioUrl || log.recorded_audio_url || log.audio_url || ''
          });
        }
      }
    } catch (error: any) {
      console.error(`--- [DEBUG] CDB API Error for Campaign ${campaignName} (ID: ${campaignId}) ---`);
      if (error.config) {
        console.error('Request URL:', error.config.url);
        console.error('Request Params:', JSON.stringify(error.config.params));
      }
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('Message:', error.message);
      }
    }
  }

  console.log(`--- [DEBUG] All campaigns processing completed. Total combined call logs: ${allCallLogs.length} ---`);
  return allCallLogs;
}
