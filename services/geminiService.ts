import { TranscriptionResult } from '../types';

export async function transcribeAudio(audioData: { mimeType: string; data: string }): Promise<TranscriptionResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioData })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '解析に失敗しました');
  }

  const { text } = await response.json();
  
  // JSON部分のみを抽出してパースする処理などは、
  // 元々の geminiService.ts にあったロジックをここに移植してください。
  // (もし単純にJSONを返しているだけなら、JSON.parse(text) でいけます)
  try {
    const jsonStr = text.replace(/```json\n?/, '').replace(/\n?```/, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("AIの応答形式が正しくありません");
  }
}
