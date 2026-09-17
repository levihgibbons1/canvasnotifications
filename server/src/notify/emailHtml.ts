/** Renders a branded HTML email body matching the app's visual identity (see client/src/styles.css). */

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ESCAPE[c]);

export function renderEmailHtml(opts: {
  eyebrow?: string;
  title: string;
  /** A short, prominent stat shown as its own block below the title (e.g. a score) — kept
   *  visually separate from the title so a long assignment name and a grade never blur together. */
  stat?: string;
  body: string;
  ctaUrl?: string;
  ctaLabel?: string;
  /** Link to the app's notification-preferences page, shown as a small footer link. */
  settingsUrl?: string;
}): string {
  const paragraphs = opts.body.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const bullet = line.startsWith('•');
    return `<p style="margin:0 0 8px;padding-left:${bullet ? '14px' : '0'};color:#4a463b;font-size:14px;line-height:1.6;">${esc(line)}</p>`;
  }).join('');
  // Each block-level div occupies its own line, so the stat badge and the CTA button always
  // stack — the inline-block *inside* each div is just what keeps them shrink-to-fit chips
  // instead of stretching edge to edge.
  const stat = opts.stat
    ? `<div style="margin:2px 0 14px;"><div style="display:inline-block;padding:10px 16px;background:#f5efe4;border:1px solid #d8cfbc;border-radius:10px;font-family:Georgia,'Iowan Old Style',serif;font-size:20px;font-weight:700;color:#16150f;">${esc(opts.stat)}</div></div>`
    : '';
  const cta = opts.ctaUrl
    ? `<div style="margin-top:6px;"><a href="${esc(opts.ctaUrl)}" style="display:inline-block;padding:10px 18px;background:#16150f;color:#f5efe4;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">${esc(opts.ctaLabel ?? 'Open')} &rarr;</a></div>`
    : '';
  const settings = opts.settingsUrl
    ? `<p style="max-width:480px;margin:8px auto 0;text-align:center;"><a href="${esc(opts.settingsUrl)}" style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#e4572e;text-decoration:underline;">Adjust notification settings</a></p>`
    : '';
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:32px 16px;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#fbf8f1;border:1px solid #d8cfbc;border-radius:14px;padding:28px;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e4572e;margin-right:8px;"></span>
        <span style="font-family:Georgia,'Iowan Old Style',serif;font-size:17px;font-weight:600;color:#16150f;">Dispatch</span>
        <span style="font-family:ui-monospace,'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8474;margin-left:8px;">for Canvas</span>
      </div>
      ${opts.eyebrow ? `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#e4572e;font-weight:600;margin-bottom:6px;">${esc(opts.eyebrow)}</div>` : ''}
      <h1 style="margin:0 0 12px;font-family:Georgia,'Iowan Old Style',serif;font-size:19px;line-height:1.3;color:#16150f;font-weight:600;">${esc(opts.title)}</h1>
      ${stat}
      ${paragraphs}
      ${cta}
    </div>
    <p style="max-width:480px;margin:16px auto 0;padding:0 4px;font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8474;text-align:center;">Dispatch for Canvas &middot; read-only, never posts on your behalf</p>
    ${settings}
  </body>
</html>`;
}
