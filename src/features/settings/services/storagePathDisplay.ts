const EBWEBVIEW_DIR_NAME = "EBWebView";

export function toEbwebviewCachePath(webviewRoot: string) {
  if (!webviewRoot) return webviewRoot;
  if (endsWithPathSegment(webviewRoot, EBWEBVIEW_DIR_NAME)) {
    return webviewRoot;
  }

  const root = webviewRoot.replace(/[\\/]+$/, "");
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root}${separator}${EBWEBVIEW_DIR_NAME}`;
}

function endsWithPathSegment(path: string, segment: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSegment = normalized.split(/[\\/]/).pop();
  return lastSegment?.toLowerCase() === segment.toLowerCase();
}
