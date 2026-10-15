import { showPdf } from "/js/pdf-preview.mjs";
const container = document.getElementById("publicQuoteViewer");
try {
  const response = await fetch(container.dataset.pdf, {
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "Unable to open this proposal. Use the PDF download link or try again.",
    );
  await showPdf(
    await response.arrayBuffer(),
    container,
    container.dataset.language,
  );
} catch (e) {
  container.textContent =
    container.dataset.language === "pl"
      ? "Nie można otworzyć podglądu. Skorzystaj z przycisku pobierania PDF lub spróbuj ponownie."
      : e.message;
}
