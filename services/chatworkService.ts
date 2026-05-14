import axios from 'axios';

export async function sendChatworkNotification(successCount: number, errorCount: number) {
  const apiToken = process.env.CHATWORK_API_TOKEN;
  const roomId = process.env.CHATWORK_ROOM_ID;

  if (!apiToken || !roomId) {
    console.warn('Chatwork credentials not found. Skipping notification.');
    return;
  }

  const dateStr = new Date().toLocaleDateString('ja-JP');
  const message = `
[info][title]【音源解析】定期処理完了のお知らせ (${dateStr})[/title]音源解析の定期処理が完了しました。

■ 処理結果
・正常完了: ${successCount} 件
・エラー発生: ${errorCount} 件

スプレッドシートをご確認ください。[/info]
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
