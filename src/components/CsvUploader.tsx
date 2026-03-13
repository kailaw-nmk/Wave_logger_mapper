'use client';

import { useCallback, useRef, useState } from 'react';

interface CsvUploaderProps {
  onFilesLoaded: (files: { text: string; fileName: string }[]) => void;
  compact?: boolean;
}

export default function CsvUploader({ onFilesLoaded, compact }: CsvUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList) => {
      const promises = Array.from(fileList).map(
        (file) =>
          new Promise<{ text: string; fileName: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              resolve({ text: e.target?.result as string, fileName: file.name });
            };
            reader.readAsText(file, 'utf-8');
          }),
      );
      Promise.all(promises).then(onFilesLoaded);
    },
    [onFilesLoaded],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    // inputをリセットして同じファイルを再選択可能にする
    e.target.value = '';
  }

  if (compact) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          padding: '4px 12px',
          border: `1px dashed ${isDragging ? '#2196F3' : '#ccc'}`,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
          color: '#666',
          backgroundColor: isDragging ? '#e3f2fd' : 'transparent',
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
        }}
      >
        + CSVを追加
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </div>
    );
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
        またはクリックしてファイルを選択（複数可）
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
