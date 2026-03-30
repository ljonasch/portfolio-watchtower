"use client";

import { useState, useEffect } from "react";
import { UploadCloud, FileImage, Loader2, AlertCircle } from "lucide-react";
import { processUpload } from "@/app/actions";

export function UploadClient({ isUpdate }: { isUpdate: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const pastedFile = items[i].getAsFile();
          if (pastedFile) {
            setFile(pastedFile);
            setError(null);
          }
          break;
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => window.removeEventListener("paste", handleGlobalPaste);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      setFile(droppedFile);
      setError(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex gap-3 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="leading-tight">{error}</div>
        </div>
      )}

      <form action={async () => {
        setIsUploading(true);
        setError(null);
        
        if (!file) {
          setError("Please select or paste a file first.");
          setIsUploading(false);
          return;
        }

        const customFormData = new FormData();
        customFormData.append("file", file);

        try {
          await processUpload(customFormData);
        } catch (e: any) {
          setError(e.message || "An error occurred while uploading.");
          setIsUploading(false);
        }
      }} className="space-y-6">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${file ? 'border-blue-500 bg-blue-900/10' : 'border-slate-700 bg-slate-900/50 hover:bg-slate-800'}`}
        >
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            {file ? (
              <>
                <FileImage className="w-12 h-12 text-blue-400 mb-4" />
                <p className="mb-2 text-sm text-slate-200 font-semibold">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
              </>
            ) : (
              <>
                <UploadCloud className="w-12 h-12 text-slate-500 mb-4" />
                <p className="mb-2 text-sm text-slate-300">
                  <span className="font-semibold text-blue-400">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-slate-500 mt-2">PNG, JPG or WEBP (Max 5MB)</p>
                <p className="text-xs text-slate-500 mt-2 font-mono bg-slate-800 px-2 py-1 rounded">Ctrl+V to paste</p>
              </>
            )}
          </div>
          <input
            type="file"
            name="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileChange}
          />
        </label>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={!file || isUploading}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 h-10 px-8 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting Data...</>
            ) : isUpdate ? 'Save Updated Screenshot' : 'Parse Holdings'}
          </button>
        </div>
      </form>
    </div>
  );
}
