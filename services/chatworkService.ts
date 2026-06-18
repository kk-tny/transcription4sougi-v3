import axios from 'axios';

export interface AccountDetail {
  accountName: string;
  incomingCount: number;
  validCount: number;
}

export async function sendChatworkNotification(
  successCount: number,
  errorCount: number,
  params?: {
    dateStr?: string;
    details?: AccountDetail[];
  }
) {
  const apiToken = process.env.CHATWORK_API_TOKEN;
  const roomId = process.env.CHATWORK_ROOM_ID;

  if (!apiToken || !roomId) {
    console.warn('Chatwork credentials not found. Skipping notification.');
    return;
  }

  // デフォルトとして今日の日付を設定（フォールバック用）
  const displayDate = params?.dateStr || new Date().toLocaleDateString('ja-JP');

  // アカウント毎の詳細テキストを作成
  let detailsText = '';
  if (params?.details && params.details.length > 0) {
    detailsText = params.details.map(detail => {
      if (detail.incomingCount === 0) {
        return `・${detail.accountName}　：　入電なし`;
      } else {
        return `・${detail.accountName}　：　${detail.validCount} / ${detail.incomingCount}`;
      }
    }).join('\n');
  } else {
    detailsText = '・（アカウント詳細情報なし）';
  }

  const message = `
[info][title]【音源解析】定期処理完了のお知らせ (${displayDate})[/title]${displayDate}入電分の音源解析の定期処理が完了しました。

■ 処理結果
・正常完了: ${successCount} 件
・エラー発生: ${errorCount} 件

■ アカウントごとの詳細（有効通話数 / 入電数）
${detailsText}

※同じお客様からのお問い合わせも個別でカウントしてますのでご注意ください。
※詳細を確認したい場合は以下のスプレッドシートをご確認ください。
　https://docs.google.com/spreadsheets/d/1kgfjvZkuMpkIc7eX4rYcFkhLiZet1W0ojmEGJPOGEPM/edit?gid=0#gid=0[/info]
  `.trim();

  try {
    await axios.post(
      `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
      `body=${encodeURIComponent(message)}`,
      {
        headers: {
          'X-ChatWorkToken': apiToken,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    console.log('Chatwork notification sent successfully.');
  } catch (error) {
    console.error('Failed to send Chatwork notification:', error);
  }
}
