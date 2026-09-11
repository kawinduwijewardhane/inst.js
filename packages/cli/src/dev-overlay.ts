export interface DevErrorInfo {
  readonly message: string;
  readonly stack?: string;
}

export const DEV_STATUS_PATH = "/.inst/dev-status";

export function formatDevError(error: unknown): DevErrorInfo {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return { message: String(error) };
}

export function createDevStatusResponse(error?: DevErrorInfo, revision = 0): Response {
  return Response.json(
    error ? { ok: false, error, revision } : { ok: true, error: null, revision },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function overlayClient(initialError?: DevErrorInfo): string {
  const initial = initialError ? JSON.stringify(initialError).replace(/</g, "\\u003c") : "null";
  return `<script data-inst-dev-overlay>
(() => {
  const statusUrl = "/.inst/dev-status";
  const hostId = "__velo_dev_error_overlay__";
  const initialError = ${initial};
  let hadBuildError = false;
  let runtimeError = Boolean(initialError);
  let revision;
  let timer;

  const removeOverlay = () => {
    document.getElementById(hostId)?.remove();
  };

  const showOverlay = (error, heading = "Inst build failed") => {
    let host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement("div");
      host.id = hostId;
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
      document.documentElement.append(host);

      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = [
        "<style>",
        ":host{all:initial}",
        ".backdrop{box-sizing:border-box;position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:rgba(9,9,11,.82);backdrop-filter:blur(6px);color:#fafafa;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}",
        ".panel{width:min(880px,100%);max-height:calc(100vh - 48px);overflow:auto;border:1px solid #3f3f46;border-radius:14px;background:#18181b;box-shadow:0 24px 70px rgba(0,0,0,.45)}",
        ".header{padding:20px 22px 16px;border-bottom:1px solid #27272a}",
        ".eyebrow{margin:0 0 8px;color:#f87171;font:700 12px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}",
        "h1{margin:0;color:#fff;font-size:22px;line-height:1.3}",
        ".body{padding:20px 22px 22px}",
        ".message{margin:0 0 16px;color:#fecaca;font:600 15px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}",
        "pre{box-sizing:border-box;margin:0;padding:14px;overflow:auto;border-radius:10px;background:#09090b;color:#d4d4d8;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}",
        ".hint{margin:16px 0 0;color:#a1a1aa;font-size:13px;line-height:1.5}",
        "</style>",
        '<div class="backdrop" role="alertdialog" aria-modal="true" aria-live="assertive">',
        '<section class="panel">',
        '<header class="header"><p class="eyebrow">Inst.js · development error</p><h1></h1></header>',
        '<div class="body"><p class="message"></p><pre hidden></pre><p class="hint">Fix the error and save. Inst will rebuild and reload this page automatically.</p></div>',
        "</section></div>",
      ].join("");
    }

    const root = host.shadowRoot;
    const title = root?.querySelector("h1");
    const message = root?.querySelector(".message");
    const stack = root?.querySelector("pre");
    if (title) title.textContent = heading;
    if (message) message.textContent = error?.message || "Unknown development error";
    if (stack) {
      const details = error?.stack || "";
      stack.textContent = details;
      stack.hidden = !details;
    }
  };

  if (initialError) showOverlay(initialError, "Request failed");

  const poll = async () => {
    try {
      const response = await fetch(statusUrl, { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) return;
      const status = await response.json();
      const previousRevision = revision;
      revision = status.revision;

      if (!status.ok) {
        runtimeError = false;
        hadBuildError = true;
        showOverlay(status.error);
        return;
      }

      if (hadBuildError) {
        removeOverlay();
        location.reload();
        return;
      }

      if (runtimeError) {
        if (previousRevision !== undefined && previousRevision !== revision) {
          removeOverlay();
          location.reload();
        }
        return;
      }

      if (previousRevision !== undefined && previousRevision !== revision) {
        location.reload();
        return;
      }

      removeOverlay();
    } catch {
      // Keep the current page and overlay usable while the development server recovers.
    } finally {
      clearTimeout(timer);
      timer = setTimeout(poll, 250);
    }
  };

  void poll();
})();
</script>`;
}

export async function injectDevOverlay(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const isHtml = contentType.includes("text/html");
  const isPlainServerError = response.status >= 500 && contentType.includes("text/plain");
  if ((!isHtml && !isPlainServerError) || response.body === null) return response;

  const body = await response.text();
  const initialError = response.status >= 500
    ? { message: body.trim() || `Request failed with HTTP ${response.status}` }
    : undefined;
  const client = overlayClient(initialError);
  const htmlBody = isHtml
    ? body
    : `<!doctype html><html><head><meta charset="utf-8"><title>Inst development error</title></head><body></body></html>`;
  const marker = "</body>";
  const markerIndex = htmlBody.toLowerCase().lastIndexOf(marker);
  const html = markerIndex >= 0
    ? `${htmlBody.slice(0, markerIndex)}${client}${htmlBody.slice(markerIndex)}`
    : `${htmlBody}${client}`;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
