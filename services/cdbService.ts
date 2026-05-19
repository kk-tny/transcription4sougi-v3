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

  // 【調査用】 /me エンドポイントでアカウント情報を取得してログ出力
  try {
    const meResponse = await axios.get('https://api-2.omni-databank.com/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'ServiceConsumerID': sid
      }
    });
    console.log('--- [DEBUG] CDB /me response ---');
    console.log(JSON.stringify(meResponse.data, null, 2));
    console.log('-------------------------------');
  } catch (meError: any) {
    console.error('--- [DEBUG] Failed to get /me info ---');
    console.error(meError.response?.data || meError.message);
  }

  // 日付形式を YYYY-MM-DD に統一（HH:mm:ss が不要な可能性があるため）
  const since = startDate.split(' ')[0];
  const until = endDate.split(' ')[0];

  console.log(`--- [DEBUG] Requesting CDB logs: since=${since}, until=${until}, sid=${sid} ---`);

  try {
    const response = await axios.get('https://api-2.omni-databank.com/behaviors/phone/calls', {
      params: { since, until },
      headers: {
        'Authorization': `Bearer ${token}`,
        'ServiceConsumerID': sid
      }
    });

    console.log('--- [DEBUG] CDB API response status:', response.status);

    // レスポンスがコレクション形式であることを考慮 (_embedded.calls)
    const logs = response.data._embedded?.calls || response.data || [];
    
    return logs.map((log: any) => ({
      account_name: log.account_name,
      campaign_name: log.campaign_name,
      call_at: log.call_at,
      observation_point_name: log.observation_point_name,
      duration: log.duration,
      caller_number: log.caller_number,
      media_number: log.media_number,
      termination_reason: log.termination_reason,
      audio_url: log.audio_url
    }));
  } catch (error: any) {
    console.error('--- [DEBUG] CDB API Error Details ---');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
      console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
    } else {
      console.error('Message:', error.message);
    }
    console.error('-------------------------------------');
    throw error;
  }
}
