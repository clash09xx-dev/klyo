const PDFDocument = require("pdfkit");
const path = require("path");
const Q = require("../../public/js/quote-core");
const FONT = path.join(__dirname, "../assets/fonts");
const safeName = (quote) =>
  `${
    Q.reference(quote)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 80) || "offer"
  }.pdf`;
function documentFor(quote) {
  const d = Q.normalizeDocument(quote.document || {});
  // Old quotes predate document snapshots. New documents preserve even an
  // intentionally empty field when the linked contact is edited later.
  if (quote.document?.version !== 1) {
    if (!d.seller.name) d.seller.name = quote.workspace_name || "";
    if (!d.buyer.name) d.buyer.name = quote.company_name || quote.contact_name || "";
    if (!d.buyer.email) d.buyer.email = quote.contact_email || "";
  }
  if (!d.issued_on)
    d.issued_on = new Date(quote.created_at || Date.now())
      .toISOString()
      .slice(0, 10);
  return d;
}
async function generateQuotePdf(quote, lineItems) {
  const config = documentFor(quote),
    L = Q.labels(config.language),
    ref = Q.reference({ ...quote, document: config }),
    accent = config.accent;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: quote.title || L.quote,
        Author: config.seller.name || "Klyo",
        Subject: ref,
        Creator: "Klyo",
      },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      doc.registerFont("Regular", path.join(FONT, "NotoSans-Regular.ttf"));
      doc.registerFont("Bold", path.join(FONT, "NotoSans-Bold.ttf"));
      doc.font("Regular");
      const width = 595.28,
        margin = 46,
        content = width - margin * 2,
        bottom = 765;
      let y = 46,
        page = 0,
        logo = null;
      if (config.logo_data_url) {
        const buffer = Buffer.from(
          config.logo_data_url.split(",")[1],
          "base64",
        );
        try {
          logo = doc.openImage(buffer);
          if (logo.width * logo.height > 2500000)
            throw new Error("Logo dimensions too large.");
        } catch {
          throw Object.assign(
            new Error("Use a valid PNG or JPEG logo under 2.5 megapixels."),
            { status: 400 },
          );
        }
      }
      const write = (
        value,
        x,
        top,
        w,
        size = 9.5,
        color = "#252d39",
        bold = false,
        options = {},
      ) => {
        doc
          .font(bold ? "Bold" : "Regular")
          .fontSize(size)
          .fillColor(color)
          .text(String(value || ""), x, top, {
            width: w,
            lineGap: 3,
            ...options,
          });
        return doc.y;
      };
      const height = (value, w, size = 9.5, bold = false) =>
        doc
          .font(bold ? "Bold" : "Regular")
          .fontSize(size)
          .heightOfString(String(value || ""), { width: w, lineGap: 3 });
      const line = (top, color = "#dce2e9") =>
        doc
          .moveTo(margin, top)
          .lineTo(width - margin, top)
          .lineWidth(0.65)
          .strokeColor(color)
          .stroke();
      function addPage(first = false) {
        doc.addPage({
          size: "A4",
          margins: { top: 62, bottom: 72, left: margin, right: margin },
        });
        page++;
        doc.rect(0, 0, width, 5).fill(accent);
        y = 46;
        if (!first) {
          write(
            config.seller.name,
            margin,
            25,
            content * 0.6,
            9,
            "#3f4b5e",
            true,
          );
          write(ref, width - margin - 160, 25, 160, 8, "#687485", false, {
            align: "right",
          });
          line(49);
          y = 69;
        }
      }
      const ensure = (h) => {
        if (y + h > bottom) addPage();
      };
      function paragraph(value, label) {
        if (!value) return;
        ensure(54);
        if (label) {
          write(label.toUpperCase(), margin, y, content, 8, accent, true);
          y += 20;
        }
        // Chunk by words so even a long single paragraph or URL can cross pages.
        for (const para of value.split("\n")) {
          if (!para.trim()) {
            y += 8;
            continue;
          }
          let remaining = para;
          while (remaining) {
            const available = bottom - y;
            if (available < 25) {
              addPage();
              continue;
            }
            let end = remaining.length;
            if (height(remaining, content) > available) {
              let lo = 1,
                hi = remaining.length;
              while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                if (height(remaining.slice(0, mid), content) <= available)
                  lo = mid;
                else hi = mid - 1;
              }
              end = lo;
              const space = remaining.lastIndexOf(" ", end);
              if (space > end * 0.65) end = space;
            }
            if (end < 1) {
              addPage();
              continue;
            }
            const chunk = remaining.slice(0, end);
            y = write(chunk, margin, y, content) + 7;
            remaining = remaining.slice(end).trimStart();
            if (remaining) addPage();
          }
        }
        y += 10;
      }
      function party(p, label, x, top, w) {
        write(label.toUpperCase(), x, top, w, 7.5, "#66748a", true);
        let yy = write(p.name, x, top + 19, w, 12, "#192434", true) + 5;
        const details = [
          p.details,
          p.tax_id ? `${L.taxId}: ${p.tax_id}` : "",
          p.email,
          p.phone,
        ]
          .filter(Boolean)
          .join("\n");
        if (details) yy = write(details, x, yy, w, 9, "#5a6676");
        return yy;
      }
      addPage(true);
      if (config.layout === "executive") {
        const headerHeight = Math.max(
          157,
          height(quote.title || L.quote, content, 23, true) + 116,
        );
        doc.rect(0, 5, width, headerHeight).fill("#152235");
        write(config.seller.name, margin, 32, 330, 12, "#ffffff", true);
        if (logo) {
          doc.roundedRect(width - margin - 116, 25, 116, 52, 4).fill("#ffffff");
          doc.image(logo, width - margin - 108, 33, {
            fit: [100, 36],
            align: "center",
            valign: "center",
          });
        }
        write(L.quote.toUpperCase(), margin, 78, content, 8, "#bcc8d7", true);
        const title = quote.title || L.quote;
        write(title, margin, 99, content, 23, "#ffffff", true);
        y = headerHeight + 25;
      } else {
        if (logo) {
          doc.image(logo, margin, 35, { fit: [135, 46], valign: "center" });
          y = 98;
        } else {
          write(config.seller.name, margin, 40, content, 16, "#182438", true);
          y = 92;
        }
        write(L.quote.toUpperCase(), margin, y, content, 8, accent, true);
        y += 21;
        const title = quote.title || L.quote;
        y = write(title, margin, y, content, 27, "#182438", true) + 25;
      }
      const meta = [
        { label: L.reference, value: ref },
        { label: L.issued, value: config.issued_on },
        { label: L.valid, value: config.valid_until || "-" },
      ];
      for (let i = 0; i < 3; i++) {
        const x = margin + (i * content) / 3;
        write(
          meta[i].label.toUpperCase(),
          x,
          y,
          content / 3 - 12,
          7,
          "#718094",
          true,
        );
        write(meta[i].value, x, y + 16, content / 3 - 12, 9.5, "#28374a", true);
      }
      y += Math.max(
        47,
        ...meta.map((m) => height(m.value, content / 3 - 12, 9.5, true) + 31),
      );
      line(y);
      y += 23;
      const partyWidth = (content - 32) / 2;
      const partyHeight = (p) =>
        height(p.name, partyWidth, 12, true) +
        height(
          [p.details, p.tax_id, p.email, p.phone].filter(Boolean).join("\n"),
          partyWidth,
          9,
        ) +
        33;
      if (
        Math.max(partyHeight(config.seller), partyHeight(config.buyer)) >
        Math.min(270, bottom - y - 25)
      ) {
        for (const [p, label] of [
          [config.seller, L.from],
          [config.buyer, L.to],
        ])
          paragraph(
            [
              p.name,
              p.details,
              p.tax_id ? L.taxId + ": " + p.tax_id : "",
              p.email,
              p.phone,
            ]
              .filter(Boolean)
              .join("\n"),
            label,
          );
      } else
        y =
          Math.max(
            party(config.seller, L.from, margin, y, partyWidth),
            party(config.buyer, L.to, margin + partyWidth + 32, y, partyWidth),
          ) + 25;
      paragraph(quote.intro_message);
      paragraph(config.scope, L.scope);
      const columns = [
        { label: L.description, width: 218, align: "left" },
        { label: L.qty, width: 40, align: "right" },
        { label: L.price, width: 91, align: "right" },
        { label: L.discount, width: 54, align: "right" },
        { label: L.amount, width: content - 403, align: "right" },
      ];
      function tableHeader() {
        ensure(65);
        write(L.items.toUpperCase(), margin, y, content, 8, accent, true);
        y += 22;
        doc.rect(margin, y, content, 27).fill("#edf1f6");
        let x = margin;
        for (const c of columns) {
          write(c.label, x + 7, y + 8, c.width - 14, 7, "#5a697e", true, {
            align: c.align,
          });
          x += c.width;
        }
        y += 27;
      }
      tableHeader();
      for (const item of lineItems || quote.line_items || []) {
        const values = [
          item.description || "",
          String(Number(item.quantity)),
          Q.money(item.unit_price, quote.currency, config.language),
          Number(item.discount_percent)
            ? `${Number(item.discount_percent)}%`
            : "-",
          Q.money(item.line_total, quote.currency, config.language),
        ];
        const rowHeight = Math.max(
          36,
          ...values.map(
            (v, i) => height(v, columns[i].width - 14, 8.5, i === 4) + 20,
          ),
        );
        // Descriptions are bounded, but exceptionally long rows are split safely.
        let remaining = values[0],
          first = true;
        do {
          if (y + Math.min(rowHeight, 200) > bottom) {
            addPage();
            tableHeader();
          }
          const maxTextHeight = bottom - y - 20;
          let end = remaining.length;
          if (height(remaining, columns[0].width - 14, 8.5) > maxTextHeight) {
            let lo = 1,
              hi = end;
            while (lo < hi) {
              const mid = Math.ceil((lo + hi) / 2);
              if (
                height(remaining.slice(0, mid), columns[0].width - 14, 8.5) <=
                maxTextHeight
              )
                lo = mid;
              else hi = mid - 1;
            }
            end = lo;
          }
          const part = remaining.slice(0, end);
          const h = Math.max(
            36,
            height(part, columns[0].width - 14, 8.5) + 20,
            ...(first
              ? values
                  .slice(1)
                  .map(
                    (v, i) =>
                      height(v, columns[i + 1].width - 14, 8.5, i === 3) + 20,
                  )
              : []),
          );
          let x = margin;
          for (let i = 0; i < columns.length; i++) {
            write(
              i === 0 ? part : first ? values[i] : "",
              x + 7,
              y + 9,
              columns[i].width - 14,
              8.5,
              "#253347",
              i === 4,
              { align: columns[i].align },
            );
            x += columns[i].width;
          }
          y += h;
          line(y, "#e3e8ef");
          remaining = remaining.slice(end).trimStart();
          first = false;
          if (remaining) {
            addPage();
            tableHeader();
          }
        } while (remaining);
      }
      y += 19;
      const summaryRows = [[L.subtotal, quote.subtotal]];
      if (Number(quote.discount_total) > 0)
        summaryRows.push([L.discount, -Number(quote.discount_total)]);
      if (Number(quote.tax_rate) > 0) {
        summaryRows.push([
          L.net,
          quote.net_total ?? Number(quote.total) - Number(quote.tax_total || 0),
        ]);
        summaryRows.push([
          `${L.tax} (${Number(quote.tax_rate)}%)`,
          quote.tax_total,
        ]);
      }
      ensure(summaryRows.length * 21 + 62);
      const summaryX = margin + content * 0.49,
        summaryW = content * 0.51;
      for (const [label, value] of summaryRows) {
        write(label, summaryX, y, summaryW * 0.5, 9, "#5d6b7c");
        write(
          Q.money(value, quote.currency, config.language),
          summaryX + summaryW * 0.5,
          y,
          summaryW * 0.5,
          9,
          "#28394d",
          false,
          { align: "right" },
        );
        y += 21;
      }
      const totalText = Q.money(quote.total, quote.currency, config.language);
      doc.font("Bold").fontSize(14);
      const totalFont = Math.max(
        8,
        Math.min(
          14,
          (14 * (summaryW * 0.66 - 10)) /
            Math.max(1, doc.widthOfString(totalText)),
        ),
      );
      doc.rect(summaryX - 10, y - 4, summaryW + 10, 41).fill("#152235");
      write(L.total, summaryX, y + 7, summaryW * 0.34, 11, "#ffffff", true);
      write(
        Q.money(quote.total, quote.currency, config.language),
        summaryX + summaryW * 0.34,
        y + 7,
        summaryW * 0.66 - 10,
        totalFont,
        "#ffffff",
        true,
        { align: "right" },
      );
      y += 63;
      paragraph(config.payment, L.payment);
      paragraph(config.delivery, L.delivery);
      paragraph(config.terms, L.terms);
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        line(791);
        write(
          config.footer || config.seller.email || config.seller.name,
          margin,
          804,
          content - 105,
          7,
          "#6c7786",
          false,
          { height: 20, ellipsis: true },
        );
        write(
          `${L.page} ${i + 1} ${L.of} ${range.count}`,
          width - margin - 100,
          804,
          100,
          7,
          "#6c7786",
          false,
          { align: "right" },
        );
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
module.exports = { generateQuotePdf, documentFor, safeName };
