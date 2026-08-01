import { get as httpGet } from "http";

export interface EverythingSearchResult {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface EverythingOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  maxResults?: number;
}

interface EverythingItem {
  name: string;
  path: string;
  type: string; // "file" or "folder"
}

interface EverythingResponse {
  results?: EverythingItem[];
}

export async function queryEverything(
  query: string,
  rootPath?: string,
  options: EverythingOptions = {},
): Promise<EverythingSearchResult[] | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const host = options.host || "127.0.0.1";
  const port = options.port || 8080;
  const timeoutMs = options.timeoutMs || 500;
  const maxResults = options.maxResults || 100;

  // Build Everything search string
  let searchParam = trimmed;
  if (rootPath) {
    const normalizedRoot = rootPath.replace(/\//g, "\\");
    searchParam = `path:"${normalizedRoot}" ${trimmed}`;
  }

  const url = `http://${host}:${port}/?search=${encodeURIComponent(searchParam)}&json=1&count=${maxResults}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: EverythingSearchResult[] | null): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = httpGet(url, (res) => {
      if (res.statusCode !== 200) {
        finish(null);
        return;
      }

      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data) as EverythingResponse;
          if (!parsed.results || !Array.isArray(parsed.results)) {
            finish(null);
            return;
          }

          const out: EverythingSearchResult[] = parsed.results.map((item) => {
            const fullPath = `${item.path}\\${item.name}`.replace(/\\/g, "/");
            const relName = rootPath
              ? fullPath.replace(new RegExp(`^${rootPath.replace(/\\/g, "/")}/?`, "i"), "")
              : item.name;
            return {
              name: relName || item.name,
              isDirectory: item.type === "folder",
              path: fullPath,
            };
          });

          finish(out);
        } catch {
          finish(null);
        }
      });
    });

    req.on("error", () => finish(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(null);
    });
  });
}
