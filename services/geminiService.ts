import { GoogleGenAI, Type } from "@google/genai";
import { TranscriptionResult } from '../types.ts';

export interface CustomMaster {
  category: string;
  formalName: string;
  reading: string;
}

export async function analyzeAudioServer(
  audioData: { mimeType: string; data: string },
  staffList?: string[],
  customMasters?: CustomMaster[]
): Promise<TranscriptionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  let staffListInstruction = "";
  if (staffList && staffList.length > 0) {
    staffListInstruction = `

【応対者判定に関する最優先個別名簿ルール】
この通話のアカウントに所属している登録スタッフ名簿の一覧は以下の通りです：
登録スタッフ名簿：[${staffList.join(", ")}]

スタッフ名を判定する際は、必ず以下の基準とプロセスに従ってください：
1. 聞き取れた発音（音声）が、この「登録スタッフ名簿」内のいずれかの名前と非常に近い、またはその候補と考えられる場合は、表記揺れを防ぎ精度を上げるために、この名簿に登録されている表記（すべて「ひらがな」）を最優先でマッピングして抽出してください（例：「よしだ」に近い発音であれば、名簿内の「よしだ」を正確にマッピングします）。
2. ただし、応対に外部のスタッフや外注を利用している場合があるため、名簿リストに存在しない人物が応答している可能性が十分にあります。音声から、名簿リスト内のどの名前とも明らかに異なる名前をはっきりと名乗っていることが聞き取れた場合は、名簿に縛られず、実際に聞き取れた正しい名前を耳で聞いた通りに正確な「ひらがな」で抽出してください。
3. もし名簿内の名前に非常に類似した発音であるが、録音状態などで僅かに聞き取りにくい（あいまいである）場合は、名簿内の対象スタッフ本人の可能性が極めて高いため、推測に任せず名簿内の名前をマッピングして適用してください。
4. 音声内でスタッフが名前を一切名乗らなかったため名前が分からない場合は、必ず「不明（名乗らず）」という固定の文字列を出力してください（「ふめい（なのらず）」などの表記揺れは禁止です）。`;
  }

  let customMasterInstruction = "";
  if (customMasters && customMasters.length > 0) {
    const listStr = customMasters
      .map(m => `- 【${m.category}】正式名称: 『${m.formalName}』 (読み: ${m.reading})`)
      .join("\n");
      
    customMasterInstruction = `

【特定固有名詞（会館名・火葬場名・社名・屋号等）の補正ルール】
この通話のアカウントに関連する固有名詞（会館、火葬場、社名等）の登録マスターリストは以下の通りです：
${listStr}

固有名詞の判定・変換を行う際は、以下の基準に必ず従ってください：
1. 会話の中で特定の会館名、火葬場名、または提携先などの固有名詞が聞き取れた場合、マスターリストにある正式名称へと補正して文字起こし、及び「具体的な内容」に反映してください。
2. もし会話内でマスターリスト内の正式名称ではなく、通称や略称、あるいは読み（ひらがな）でのみ呼ばれていた場合、これらをそのままにせず、必ずマスターリストの「正式名称（漢字・正しい表記）」をそのまま正確に適用し、文字起こしの誤字・脱字を防止してください。
3. もしマスターリストの「読み」と、音声で呼ばれている名称の響きがほぼ同じである場合、文字起こしの自動認識による偶発的な誤変換を避け、マスターリストの正式な漢字/表記へと変換して出力してください。`;
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { data: audioData.data, mimeType: audioData.mimeType } },
          { text: "葬儀社に掛かってきた電話の音声を解析し、指定されたフォーマットで情報を抽出してください。特に名前は必ず「ひらがな」で抽出してください。" }
        ]
      }
    ],
    config: {
      systemInstruction: `あなたは葬儀社の熟練事務スタッフです。葬儀社宛の電話内容を正確に解析し、以下の項目を抽出してください。

1. ご相談者様名: 電話をしてきた人の名前。必ず「ひらがな」で抽出してください。不明な場合は「不明」としてください。
2. ご対象者様名: 亡くなられた方の名前。必ず「ひらがな」で抽出してください。不明な場合は「不明」としてください。
3. 応対者名: 電話を受けた葬儀社側のスタッフ名。必ず「ひらがな」で抽出してください。音声内で名乗らなかったため名前がわからない場合は、必ず「不明（名乗らず）」という文字列を出力してください（「ふめい（なのらず）」などの表記揺れは禁止です）。複数いる場合、電話を受けた順番（会話に登場した順）にリスト形式で抽出してください。${staffListInstruction}
4. 問い合わせの種類: 以下の定義に基づき、最も適切なものを1つ選んでください。
   - 訃報: 家族や身内が亡くなった状況での葬儀相談（例外1：過去に事前相談や会員になっていた方からの葬儀依頼は、この区分「訃報」としてください。例外2：単に訃報ハガキや案内状等の作成・送付のみを希望するお問い合わせ（例：「亡くなった父親の葬儀が終了したことを報告するための、訃報のハガキを作成したい」など）は、葬儀自体の依頼・相談ではないため「その他」に分類してください）
   - 訃報（依頼済みの方から再連絡）: 既に葬儀を依頼したお客様からの折り返し電話（例：病院や警察から搬送車で迎えに来てもらう時間が決まった際の連絡、葬儀の契約にあたり必要な物の確認連絡など）。※例外として、過去に事前相談や会員になっていた方からの最初の葬儀依頼は、この区分ではなく「訃報」としてください。
   - 事前相談: 家族や身内でもうすぐ亡くなる可能性がある方の葬儀相談
   - 自身の事前相談: 電話をしてきた人本人が、将来自分自身が亡くなった時の葬儀を検討している相談
   - 参列問い合わせ: 誰かの葬儀に参列するために、時間確認や会場への行き方を知りたい方からのお問合せ
   - 供花、供物の注文依頼: 誰かの葬儀に贈る葬儀のお花（供花）や供物の注文、および弔電の送付についてのお問合せ
   - 間違い電話（葬儀相談）: 火葬場、および自社以外の葬儀社 / 葬儀式場 / 葬儀会館と間違えたもののうち、「訃報」もしくは「事前相談」に該当する葬儀相談
   - 間違い電話（葬儀相談以外）: 火葬場、および自社以外の葬儀社 / 葬儀式場 / 葬儀会館と間違えたもののうち、「訃報」もしくは「事前相談」以外のお問い合わせ
   - 間違い電話（葬儀社以外宛）: 火葬場、および葬儀社 / 葬儀式場 / 葬儀会館とは関係のない場所と間違えたもの
   - その他: 上記に該当しない内容のお問合せ（例：単に訃報ハガキや案内状等の作成・送付のみを希望するお問合せなどもここに含めます）
5. 具体的な内容: 電話の内容を簡潔にまとめてください。出力形式は「・」で始まる箇書き（Array形式）とし、各要素の冒頭には必ず「・」を含めてください。
6. 文字起こし: 全ての会話を話者ごとに正確に記録してください。${customMasterInstruction}`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          callerName: { type: Type.STRING },
          subjectName: { type: Type.STRING },
          responderNames: { type: Type.ARRAY, items: { type: Type.STRING } },
          inquiryType: { 
            type: Type.STRING,
            enum: ['訃報', '訃報（依頼済みの方から再連絡）', '事前相談', '自身の事前相談', '参列問い合わせ', '供花、供物の注文依頼', '間違い電話（葬儀相談）', '間違い電話（葬儀相談以外）', '間違い電話（葬儀社以外宛）', 'その他']
          },
          details: { type: Type.ARRAY, items: { type: Type.STRING } },
          transcription: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { speaker: { type: Type.STRING }, transcript: { type: Type.STRING } },
              required: ["speaker", "transcript"]
            }
          }
        },
        required: ["callerName", "subjectName", "responderNames", "inquiryType", "details", "transcription"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("AIからの応答が空でした");
  return JSON.parse(text);
}

// クライアントサイドでの互換性のために残す（既存のコードが fetch を使っている場合用）
export async function transcribeAudio(
  audioData: { mimeType: string; data: string },
  accountName?: string
): Promise<TranscriptionResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioData, accountName })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || '解析に失敗しました');
  }

  const resultData = await response.json();
  const text = resultData.text;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("JSON形式のデータが見つかりませんでした");
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Parse Error:", text);
    throw new Error("AIの応答を解析できませんでした");
  }
}
