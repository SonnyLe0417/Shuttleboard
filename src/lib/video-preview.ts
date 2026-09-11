export function shouldCreateBrowserPreview(
  file: Pick<File, "name"> | null,
  previewWasAttempted: boolean,
) {
  return Boolean(file) && !previewWasAttempted;
}

export function previewFailureMessage(detail?: string) {
  return `This video could not be previewed. ${detail || "Try exporting it as an MP4 or MOV file."}`;
}
