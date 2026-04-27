
export enum InputMethod {
  File = 'file',
  Url = 'url',
}

export interface TranscriptionSegment {
  speaker: string;
  transcript: string;
}

export interface TranscriptionResult {
  callerName: string;
  subjectName: string;
  responderNames: string[];
  inquiryType: '訃報' | '事前相談' | '自身の事前相談' | '参列問い合わせ' | '供花、供物の注文依頼' | '間違い電話（葬儀相談）' | '間違い電話（葬儀相談以外）' | '間違い電話（葬儀社以外宛）' | 'その他';
  details: string[];
  transcription: TranscriptionSegment[];
}
