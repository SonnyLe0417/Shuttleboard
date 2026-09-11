export function isSupportedVideo(file: Pick<File, "type">) {
  return file.type.startsWith("video/");
}
