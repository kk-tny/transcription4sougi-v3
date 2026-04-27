
import React, { useState, useCallback } from 'react';
import { TranscriptionSegment, TranscriptionResult } from './types';
import { fileToBase64 } from './utils/audioUtils';
import { transcribeAudio } from './services/geminiService';

// --- SVG Icons --- //
const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const InfoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const Spinner = () => (
  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600"></div>
);

// --- Helper Components --- //

interface FileInputFormProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  isLoading: boolean;
}
const FileInputForm: React.FC<FileInputFormProps> = ({ file, onFileChange, isLoading }) => {
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileChange(e.target.files[0]);
        }
    };

    const handleClearFile = () => {
        onFileChange(null);
        const input = document.getElementById('file-upload') as HTMLInputElement;
        if (input) input.value = '';
    }

    return (
        <div className="w-full">
            <label htmlFor="file-upload" className={`relative flex flex-col items-center justify-center w-full h-40 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}>
                {file ? (
                    <div className="text-center p-4">
                       <p className="font-bold text-sky-700 text-lg mb-1">{file.name}</p>
                       <p className="text-xs text-slate-500 font-mono">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <div className="p-3 bg-sky-100 rounded-full mb-4">
                            <UploadIcon />
                        </div>
                        <p className="mb-2 text-sm text-slate-600"><span className="font-bold text-sky-600">音声ファイルをアップロード</span>してください</p>
                        <p className="text-xs text-slate-400">MP3, WAV, M4A などに対応しています</p>
                    </div>
                )}
                <input id="file-upload" type="file" className="hidden" onChange={handleFileChange} accept="audio/*" disabled={isLoading} />
            </label>
            {file && !isLoading && (
                <button onClick={handleClearFile} className="mt-3 text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mx-auto transition-colors">
                    <TrashIcon /> 選択したファイルを解除
                </button>
            )}
        </div>
    );
};

// --- Result View Component --- //
const ResultDisplay: React.FC<{ result: TranscriptionResult }> = ({ result }) => {
  // 応対者名の正規化（ふめい(なのらず) を 不明（名乗らず） に統一）
  const normalizedResponders = result.responderNames.map(name => 
    (name === 'ふめい（なのらず）' || name === 'ふめい' || name === '不明') ? '不明（名乗らず）' : name
  );

  // 応対者名のフォーマット（複数いる場合は矢印で繋ぐ）
  const formattedResponders = normalizedResponders.length > 0 
    ? normalizedResponders.join('　→　') 
    : '不明（名乗らず）';

  // ユーザー指定の厳密なフォーマット
  const formattedSummary = `=====================================

◎ご相談者様名　：　${result.callerName}

◎ご対象者様名　：　${result.subjectName}

◎応対者名　：　${formattedResponders}

◎問い合わせの種類　：　${result.inquiryType}

◎具体的な内容
${result.details.map(d => d.startsWith('・') ? d : `・${d}`).join('\n')}

=====================================`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(formattedSummary);
    alert('フォーマット済みテキストをコピーしました');
  };

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
           <h3 className="text-lg font-bold text-slate-800">解析レポート</h3>
           <button 
             onClick={copyToClipboard}
             className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm text-sm font-bold text-slate-600"
           >
             <CopyIcon /> コピーする
           </button>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-inner">
          <div className="space-y-4 font-mono text-sm sm:text-base whitespace-pre-wrap text-emerald-400 overflow-x-auto leading-relaxed">
              {formattedSummary}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800 border-l-4 border-sky-500 pl-3">全文文字起こし</h3>
        <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
          {result.transcription.map((seg, idx) => (
            <div key={idx} className="flex flex-col space-y-1 border-b border-slate-200 pb-3 last:border-0 last:pb-0">
              <span className="text-xs font-bold text-sky-700">{seg.speaker}</span>
              <p className="text-sm text-slate-700 leading-relaxed">
                {seg.transcript}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Main App Component --- //
const Login: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  // ... (Login component content remains the same)
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'tonegawa12345') {
      onLogin();
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-6 border border-slate-200">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-black text-slate-900">認証が必要です</h1>
          <p className="text-slate-500 text-sm">パスワードを入力してください</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            placeholder="パスワード"
            className={`w-full px-4 py-3 rounded-xl border ${error ? 'border-red-500 bg-red-50' : 'border-slate-200'} focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all`}
            autoFocus
          />
          {error && <p className="text-red-500 text-xs font-bold text-center">パスワードが正しくありません</p>}
          <button
            type="submit"
            className="w-full py-3 bg-sky-600 text-white rounded-xl font-bold hover:bg-sky-700 transition-all shadow-lg shadow-sky-200"
          >
            ログイン
          </button>
        </form>
      </div>
    </div>
  );
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // スプレッドシート連携用ステート
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, status: '' });

  const handleTranscribe = useCallback(async () => {
    if (!audioFile) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const base64 = await fileToBase64(audioFile);
      const audioData = { mimeType: audioFile.type, data: base64 };
      const data = await transcribeAudio(audioData);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [audioFile]);

  // スプレッドシート一括処理ロジック
  const handleBatchProcess = async () => {
    setIsBatchProcessing(true);
    setError(null);
    try {
      // 1. スプレッドシートからデータを取得
      setBatchProgress({ current: 0, total: 0, status: 'スプレッドシートを読み込んでいます...' });
      const res = await fetch('/api/sheets/data');
      const { values, error: sheetsError } = await res.json();
      if (sheetsError) throw new Error(sheetsError);

      const total = values.length;
      setBatchProgress(p => ({ ...p, total }));

      // 2. 1行ずつ処理
      let successCount = 0;
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const audioUrl = row[6]; // G列 (index 6)

        if (!audioUrl || !audioUrl.startsWith('http')) {
          setBatchProgress(p => ({ ...p, current: i + 1, status: `行 ${i + 4}: URLが無効なためスキップします` }));
          continue;
        }

        let rowSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!rowSuccess && retryCount < maxRetries) {
          try {
            setBatchProgress(p => ({ 
              ...p, 
              current: i + 1, 
              status: `行 ${i + 4}${retryCount > 0 ? ` (再試行 ${retryCount})` : ''}: 音源を取得中...` 
            }));

            // 音源をプロキシ経由で取得
            const audioRes = await fetch(`/api/proxy-audio?url=${encodeURIComponent(audioUrl)}`);
            if (!audioRes.ok) throw new Error('音源の取得に失敗しました');
            
            const blob = await audioRes.blob();
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
              reader.readAsDataURL(blob);
            });
            const base64 = await base64Promise;

            setBatchProgress(p => ({ ...p, status: `行 ${i + 4}: AI解析中...` }));
            const analysis = await transcribeAudio({ mimeType: blob.type, data: base64 });

            setBatchProgress(p => ({ ...p, status: `行 ${i + 4}: スプレッドシートに書き込み中...` }));
            
            // 応対者名の正規化（ふめい(なのらず) を 不明（名乗らず） に統一）
            const normalizedResponders = analysis.responderNames.map(name => 
              (name === 'ふめい（なのらず）' || name === 'ふめい' || name === '不明') ? '不明（名乗らず）' : name
            );

            await fetch('/api/sheets/update-row', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                rowIndex: i,
                data: {
                  callerName: analysis.callerName,
                  subjectName: analysis.subjectName,
                  responderNames: normalizedResponders.join('　→　'),
                  inquiryType: analysis.inquiryType,
                  details: analysis.details.map(d => d.startsWith('・') ? d : `・${d}`).join('\n')
                }
              })
            });

            rowSuccess = true;
            successCount++;

            // 有料プランのため待機時間を大幅に短縮（0.5秒）
            if (i < values.length - 1) {
              setBatchProgress(p => ({ ...p, status: `行 ${i + 4}: 完了。次へ進みます...` }));
              await new Promise(resolve => setTimeout(resolve, 500)); 
            }
          } catch (err: any) {
            console.error(`Error processing row ${i + 4}:`, err);
            
            // 有料プランでも稀に発生する可能性があるため、短い待機で再試行
            if (err.message) {
                const isRateLimit = err.message.includes('429') || err.message.includes('quota') || err.message.includes('limit');
                if (isRateLimit) {
                  retryCount++;
                  if (retryCount < maxRetries) {
                    setBatchProgress(p => ({ ...p, status: `行 ${i + 4}: 一時的な制限。5秒待機して再試行します (${retryCount}/${maxRetries})...` }));
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue; 
                  }
                }
            }
            
            setBatchProgress(p => ({ ...p, status: `行 ${i + 4}: エラーのためスキップします` }));
            break; 
          }
        }
      }
      setBatchProgress(p => ({ ...p, status: `一括処理が完了しました（成功: ${successCount}件 / 全体: ${values.length}件）` }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleReset = () => {
    setAudioFile(null);
    setResult(null);
    setError(null);
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 md:p-12 selection:bg-sky-100 selection:text-sky-900">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="text-center space-y-3">
          <div className="inline-block bg-sky-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider mb-2">Internal Use Only</div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">葬儀社用 電話応対解析ツール</h1>
          <p className="text-slate-500 font-medium">録音データをアップロードして、報告用フォーマットを自動生成します</p>
        </header>

        {/* スプレッドシート連携セクション */}
        <section className="bg-emerald-50 rounded-2xl border border-emerald-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-100 rounded-lg text-emerald-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="font-bold text-emerald-900">スプレッドシート一括解析</h2>
              <a 
                href="https://docs.google.com/spreadsheets/d/1Kr9efkALVJx0iGxbGaOBzQduQbD-Qw8kUqsjhuhHQ8s/edit?gid=0#gid=0" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-emerald-600 hover:text-emerald-800 underline flex items-center gap-1"
              >
                シートはこちら
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
            <button
              onClick={handleBatchProcess}
              disabled={isBatchProcessing}
              className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:bg-slate-300 transition-all shadow-md shadow-emerald-200"
            >
              {isBatchProcessing ? '処理中...' : '一括解析を開始'}
            </button>
          </div>
          
          {isBatchProcessing || batchProgress.status ? (
            <div className="bg-white rounded-xl p-4 border border-emerald-100 space-y-3">
              <div className="flex justify-between text-xs font-bold text-emerald-700">
                <span>{batchProgress.status}</span>
                {batchProgress.total > 0 && (
                  <span>{batchProgress.current} / {batchProgress.total}</span>
                )}
              </div>
              <div className="w-full bg-emerald-100 rounded-full h-2">
                <div 
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                ></div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-emerald-600">
              G列の音源URLを読み込み、解析結果をB〜F列に自動で書き込みます（4行目以降）。
            </p>
          )}
        </section>

        <section className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
          <div className="p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-sky-100 rounded-lg text-sky-700">
                <UploadIcon />
              </div>
              <h2 className="font-bold text-slate-900">個別ファイル解析</h2>
            </div>
            <FileInputForm file={audioFile} onFileChange={setAudioFile} isLoading={isLoading} />
            
            <div className="flex gap-3">
                <button
                onClick={handleTranscribe}
                disabled={isLoading || !audioFile || isBatchProcessing}
                className="flex-1 py-4 bg-sky-600 text-white rounded-xl font-bold hover:bg-sky-700 active:scale-[0.98] disabled:bg-slate-300 disabled:scale-100 transition-all flex items-center justify-center space-x-2 shadow-lg shadow-sky-200 disabled:shadow-none"
                >
                {isLoading ? (
                    <>
                        <Spinner />
                        <span>AIが解析しています...</span>
                    </>
                ) : (
                    <span>解析を実行する</span>
                )}
                </button>
                {result && !isLoading && (
                    <button
                        onClick={handleReset}
                        className="px-6 py-4 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                    >
                        やり直し
                    </button>
                )}
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-5 rounded-2xl flex items-start space-x-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="mt-1 flex-shrink-0">
                <InfoIcon />
            </div>
            <div className="space-y-1">
                <p className="font-bold">エラーが発生しました</p>
                <p className="text-sm opacity-90">{error}</p>
            </div>
          </div>
        )}

        {result && (
          <section className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-6 sm:p-10 animate-in fade-in zoom-in-95 duration-500">
            <ResultDisplay result={result} />
          </section>
        )}

        <footer className="text-center pt-4">
            <p className="text-xs text-slate-400 font-medium tracking-wide">© 2024 Funeral Support System | Powered by Gemini 3 Flash</p>
        </footer>
      </div>
    </div>
  );
}
