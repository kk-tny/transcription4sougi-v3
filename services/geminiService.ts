
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { TranscriptionResult } from "../types";

// APIキーの取得（Viteのビルド時注入とランタイムの両方に対応）
const getApiKey = () => {
  const key = (import.meta as any).env?.VITE_GEMINI_API_KEY || 
              process.env.GEMINI_API_KEY || 
              process.env.API_KEY;
  return key;
};

const ai = new GoogleGenAI({ apiKey: getApiKey() || "" });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface AudioInput {
  mimeType: string;
  data: string;
}

export const transcribeAudio = async (audio: AudioInput): Promise<TranscriptionResult> => {
  const models = ["gemini-3-flash-preview", "gemini-2.5-flash"];
  const maxRetriesPerModel = 2;
  const initialDelay = 2000;

  let lastError: any = null;

  for (const modelName of models) {
    for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
      try {
        console.log(`Attempting transcription with ${modelName} (Attempt ${attempt + 1}/${maxRetriesPerModel})`);
        
        const audioPart = {
          inlineData: {
            mimeType: audio.mimeType,
            data: audio.data,
          },
        };

        const textPart = {
          text: "葬儀社に掛かってきた電話の音声を解析し、指定されたフォーマットで情報を抽出してください。特に名前は必ず「ひらがな」で抽出してください。"
        };

        const response: GenerateContentResponse = await ai.models.generateContent({
          model: modelName,
          contents: { 
            parts: [audioPart, textPart] 
          },
          config: {
            systemInstruction: `あなたは葬儀社の熟練事務スタッフです。葬儀社宛の電話内容を正確に解析し、以下の項目を抽出してください。

1. ご相談者様名: 電話をしてきた人の名前。必ず「ひらがな」で抽出してください。不明な場合は「不明」としてください。
2. ご対象者様名: 亡くなられた方の名前。必ず「ひらがな」で抽出してください。不明な場合は「不明」としてください。
3. 応対者名: 電話を受けた葬儀社側のスタッフ名。必ず「ひらがな」で抽出してください。音声内で名乗らなかったため名前がわからない場合は「不明（名乗らず）」としてください。複数いる場合、電話を受けた順番（会話に登場した順）にリスト形式で抽出してください。
4. 問い合わせの種類: 以下の定義に基づき、最も適切なものを1つ選んでください。
   - 訃報: 家族や身内が亡くなった状況での葬儀相談
   - 事前相談: 家族や身内でもうすぐ亡くなる可能性がある方の葬儀相談
   - 自身の事前相談: 電話をしてきた人本人が、将来自分自身が亡くなった時の葬儀を検討している相談
   - 参列問い合わせ: 誰かの葬儀に参列するために、時間確認や会場への行き方を知りたい方からのお問合せ
   - 供花、供物の注文依頼: 誰かの葬儀に贈る葬儀の御花や供物の注文についてのお問合せ
   - 間違い電話（葬儀社宛）: 自社以外の葬儀社 / 葬儀式場 / 葬儀会館と間違えたもの
   - 間違い電話（葬儀社以外宛）: 葬儀社 / 葬儀式場 / 葬儀会館とは関係のない場所と間違えたもの
   - その他: 上記に該当しない内容のお問合せ
5. 具体的な内容: 電話の内容を簡潔な箇条書き（「・」で始まる形式）でまとめてください。
6. 文字起こし: 全ての会話を話者ごとに正確に記録してください。`,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                callerName: {
                  type: Type.STRING,
                  description: "相談者の名前（必ずひらがな）",
                },
                subjectName: {
                  type: Type.STRING,
                  description: "亡くなられた方の名前（必ずひらがな）",
                },
                responderNames: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "応対者の名前リスト（必ずひらがな、登場順。不明な場合は 不明（名乗らず））",
                },
                inquiryType: {
                  type: Type.STRING,
                  enum: ['訃報', '事前相談', '自身の事前相談', '参列問い合わせ', '供花、供物の注文依頼', '間違い電話（葬儀社宛）', '間違い電話（葬儀社以外宛）', 'その他'],
                  description: "問い合わせのカテゴリー",
                },
                details: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "具体的な内容の箇記事項（文頭の・は含めない）",
                },
                transcription: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      speaker: { type: Type.STRING },
                      transcript: { type: Type.STRING },
                    },
                    required: ["speaker", "transcript"],
                  },
                },
              },
              required: ["callerName", "subjectName", "responderNames", "inquiryType", "details", "transcription"],
            },
          }
        });

        const transcriptionText = response.text;
        if (!transcriptionText) {
           throw new Error("APIは空の応答を返しました。");
        }

        return JSON.parse(transcriptionText) as TranscriptionResult;

      } catch (error: any) {
        lastError = error;
        console.error(`Gemini API Error with ${modelName}:`, error);
        
        const isRetryable = error.message?.includes("503") || 
                            error.message?.includes("504") ||
                            error.message?.includes("UNAVAILABLE") || 
                            error.message?.includes("high demand") ||
                            error.status === 503;

        if (isRetryable) {
          if (attempt < maxRetriesPerModel - 1) {
            const delay = initialDelay * Math.pow(2, attempt);
            console.warn(`Retrying ${modelName} in ${delay}ms...`);
            await sleep(delay);
            continue;
          } else {
            console.warn(`${modelName} failed after all retries. Trying next model if available...`);
            break; 
          }
        }

        throw error;
      }
    }
  }

  if (lastError instanceof Error) {
      throw new Error(`解析に失敗しました。現在サーバーが非常に混み合っています。しばらく時間をおいてから再度お試しください。 (詳細: ${lastError.message})`);
  }
  throw new Error("不明なエラーが発生しました。しばらく時間をおいてから再度お試しください。");
};
