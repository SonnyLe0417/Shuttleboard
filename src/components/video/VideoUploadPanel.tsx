import { Upload } from "lucide-react";

export function VideoUploadPanel({ onFile }: { onFile: (file: File) => void }) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card p-10 text-center transition-colors hover:border-primary/60">
      <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
      <span className="text-sm font-medium text-foreground">Click to upload a game video</span>
      <span className="mt-1 text-xs text-muted-foreground">
        MP4 / WebM / MOV — up to a few minutes
      </span>
      <input
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
