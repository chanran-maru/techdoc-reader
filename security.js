// Shared by trusted extension pages and the isolated content-script world.
globalThis.TechDocSecurity = Object.freeze({
  sourceURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  },
  csvCell(value) {
    let text = String(value ?? "");
    // CSV quoting alone does not stop spreadsheet formula interpretation.
    // Include whitespace/control prefixes that spreadsheet importers may discard.
    if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) {
      text = "'" + text;
    }
    return `"${text.replace(/"/g, '""')}"`;
  },
});
