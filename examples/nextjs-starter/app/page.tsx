'use client';

import { useState } from 'react';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    setAnswer('');
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setAnswer(data.text ?? data.error ?? '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>llm-runner 데모</h1>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="질문을 입력하세요"
        rows={4}
        style={{ width: '100%' }}
      />
      <button onClick={handleSubmit} disabled={loading || !prompt}>
        {loading ? '생성 중...' : '물어보기'}
      </button>
      {answer && (
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: 20 }}>{answer}</pre>
      )}
    </main>
  );
}
