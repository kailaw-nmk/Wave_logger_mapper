'use client';

import { useCallback, useRef, useState } from 'react';

interface CsvUploaderProps {
  onFileLoaded: (text: string, fileName: string) => void;
}

export default function CsvUploader({ onFileLoaded }: CsvUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        onFileLoaded(text, file.name);
      };
      reader.readAsText(file, 'utf-8');
    },
    [onFileLoaded],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${isDragging ? '#2196F3' : '#ccc'}`,
        borderRadius: 12,
        padding: '40px 20px',
        textAlign: 'center',
        cursor: 'pointer',
        backgroundColor: isDragging ? '#e3f2fd' : '#fafafa',
        transition: 'all 0.2s',
      }}
    >
      <p style={{ margin: 0, fontSize: 16, color: '#666' }}>
        CSVファイルをドラッグ&ドロップ
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: '#999' }}>
        またはクリックしてファイルを選択
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
