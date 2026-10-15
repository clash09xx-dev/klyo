importScripts("/vendor/sheetjs/xlsx-0.20.3.min.js");
self.onmessage = (e) => {
  try {
    const book = XLSX.read(e.data.buffer, {
        type: "array",
        sheetRows: 1002,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
      }),
      name = e.data.sheet || book.SheetNames[0];
    if (!book.Sheets[name]) throw new Error("Choose an available worksheet.");
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    if (rows.length > 1001)
      throw new Error("Import up to 1,000 products at a time.");
    if (rows.length < 2)
      throw new Error("Add a header row and at least one product.");
    postMessage({
      sheets: book.SheetNames,
      sheet: name,
      headers: rows[0].map(String),
      rows: rows.slice(1),
    });
  } catch (e) {
    postMessage({ error: e.message });
  }
};
