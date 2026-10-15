const PDFDocument = require("pdfkit"),
  path = require("path"),
  C = require("../../public/js/quote-canvas-core"),
  Q = require("../../public/js/quote-core");
const MM = 72 / 25.4,
  FONT = path.join(__dirname, "../assets/fonts");
module.exports = async function canvasPdf(quote, items, d) {
  const design = C.normalize(d.canvas),
    doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: quote.title || "Proposal",
        Author: d.seller.name,
        Creator: "Klyo",
      },
    }),
    chunks = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      doc.registerFont("Regular", path.join(FONT, "NotoSans-Regular.ttf"));
      doc.registerFont("Bold", path.join(FONT, "NotoSans-Bold.ttf"));
      const font = (e, bold = e.bold) =>
        doc.font(bold ? "Bold" : "Regular").fontSize(e.font_size);
      function split(value, width, size, height) {
        doc.font("Regular").fontSize(size);
        const result = [];
        let rest = String(value || "");
        while (rest) {
          let end = rest.length;
          if (doc.heightOfString(rest, { width, lineGap: 1 }) > height) {
            let lo = 1,
              hi = end;
            while (lo < hi) {
              const mid = Math.ceil((lo + hi) / 2);
              if (
                doc.heightOfString(rest.slice(0, mid), { width, lineGap: 1 }) <=
                height
              )
                lo = mid;
              else hi = mid - 1;
            }
            end = lo;
            const space = rest.lastIndexOf(" ", end);
            if (space > end * 0.6) end = space;
          }
          if (end < 1)
            throw Object.assign(
              new Error("Increase the height of the pricing table."),
              { status: 400 },
            );
          result.push(rest.slice(0, end));
          rest = rest.slice(end).trimStart();
        }
        return result.length ? result : [""];
      }
      function tableParts(e) {
        const body = e.h * MM - 24,
          desc = e.w * MM * 0.44 - 12,
          size = e.font_size;
        const pages = [[]];
        let used = 0;
        for (const item of items) {
          const parts = split(item.description, desc, size, body - 12);
          for (let i = 0; i < parts.length; i++) {
            doc.font("Regular").fontSize(size);
            const height = Math.max(
              24,
              doc.heightOfString(parts[i], { width: desc, lineGap: 1 }) + 12,
            );
            if (used + height > body) {
              pages.push([]);
              used = 0;
            }
            pages
              .at(-1)
              .push({ item, description: parts[i], first: i === 0, height });
            used += height;
          }
        }
        return pages;
      }
      const pages = [];
      for (const page of design.pages) {
        const table = page.elements.find((e) => e.type === "items"),
          parts = table ? tableParts(table) : [null];
        parts.forEach((rows, i) =>
          pages.push({
            page,
            rows,
            first: i === 0,
            last: i === parts.length - 1,
          }),
        );
      }
      if (pages.length > 200)
        throw Object.assign(
          new Error(
            "This document is too long. Use fewer items or a larger pricing table.",
          ),
          { status: 400 },
        );
      const money = (v) => Q.money(v, quote.currency, d.language),
        L = Q.labels(d.language),
        context = { ...d, reference: Q.reference(quote) };
      function text(value, e, bold = e.bold) {
        let size = e.font_size;
        const width = e.w * MM,
          height = e.h * MM;
        for (; size > 6; size -= 0.25) {
          doc.font(bold ? "Bold" : "Regular").fontSize(size);
          if (doc.heightOfString(value, { width, lineGap: 1 }) <= height) break;
        }
        doc.font(bold ? "Bold" : "Regular").fontSize(Math.max(6, size));
        if (doc.heightOfString(value, { width, lineGap: 1 }) > height + 0.1)
          throw Object.assign(
            new Error(
              "An element is too small for its text. Enlarge it in the A4 designer.",
            ),
            { status: 400 },
          );
        doc
          .fillColor(e.color)
          .text(value, e.x * MM, e.y * MM, {
            width,
            height,
            lineGap: 1,
            align: e.align,
          });
      }
      function table(e, rows) {
        const x = e.x * MM,
          w = e.w * MM,
          size = e.font_size;
        let y = e.y * MM;
        const fractions = [0.44, 0.08, 0.18, 0.12, 0.18],
          labels = [L.description, L.qty, L.price, L.discount, L.amount];
        doc.rect(x, y, w, 24).fill(e.fill || "#edf1f6");
        let left = x;
        labels.forEach((label, i) => {
          doc
            .font("Bold")
            .fontSize(Math.max(6, size - 1))
            .fillColor(e.color)
            .text(label, left + 5, y + 6, {
              width: w * fractions[i] - 10,
              height: 18,
              align: i ? "right" : "left",
              lineGap: 0,
            });
          left += w * fractions[i];
        });
        y += 24;
        for (const row of rows || []) {
          const v = [
            row.description,
            row.first ? String(Number(row.item.quantity)) : "",
            row.first ? money(row.item.unit_price) : "",
            row.first ? (Number(row.item.discount_percent) || 0) + "%" : "",
            row.first ? money(row.item.line_total) : "",
          ];
          let left = x;
          v.forEach((value, i) => {
            let fontSize = size;
            doc.font(i === 4 ? "Bold" : "Regular").fontSize(fontSize);
            while (
              fontSize > 6 &&
              doc.heightOfString(value, {
                width: w * fractions[i] - 10,
                lineGap: 1,
              }) >
                row.height - 10
            )
              doc.fontSize((fontSize -= 0.25));
            if (
              doc.heightOfString(value, {
                width: w * fractions[i] - 10,
                lineGap: 1,
              }) >
              row.height - 9.9
            )
              throw Object.assign(
                new Error(
                  "Increase the width of the pricing table to fit the amounts.",
                ),
                { status: 400 },
              );
            doc
              .fillColor(e.color)
              .text(value, left + 5, y + 6, {
                width: w * fractions[i] - 10,
                height: row.height - 10,
                align: i ? "right" : "left",
                lineGap: 1,
              });
            left += w * fractions[i];
          });
          y += row.height;
          doc
            .moveTo(x, y)
            .lineTo(x + w, y)
            .lineWidth(0.5)
            .strokeColor("#d0d5dd")
            .stroke();
        }
      }
      pages.forEach((entry, index) => {
        doc.addPage({ size: "A4", margin: 0 });
        doc.rect(0, 0, 210 * MM, 297 * MM).fill(entry.page.background);
        for (const e of entry.page.elements) {
          if (
            (e.visibility === "first" && !entry.first) ||
            (e.visibility === "last" && !entry.last)
          )
            continue;
          if (e.type === "items") {
            table(e, entry.rows);
            continue;
          }
          if (e.type === "rectangle") {
            doc
              .rect(e.x * MM, e.y * MM, e.w * MM, e.h * MM)
              .fill(e.fill || e.color);
            continue;
          }
          if (e.type === "line") {
            doc
              .moveTo(e.x * MM, e.y * MM)
              .lineTo((e.x + e.w) * MM, (e.y + e.h) * MM)
              .lineWidth(1)
              .strokeColor(e.color)
              .stroke();
            continue;
          }
          if (e.type === "image") {
            const data = e.image || d.logo_data_url;
            if (data) {
              let image;
              try {
                image = doc.openImage(
                  Buffer.from(data.split(",")[1], "base64"),
                );
              } catch {
                throw Object.assign(
                  new Error("Use a valid PNG or JPEG image."),
                  { status: 400 },
                );
              }
              if (image.width * image.height > 2500000)
                throw Object.assign(
                  new Error("Use images below 2.5 megapixels."),
                  { status: 400 },
                );
              doc.image(image, e.x * MM, e.y * MM, {
                fit: [e.w * MM, e.h * MM],
                align: "center",
                valign: "center",
              });
            }
            continue;
          }
          if (e.fill)
            doc.rect(e.x * MM, e.y * MM, e.w * MM, e.h * MM).fill(e.fill);
          if (e.type === "totals") {
            const values = [
              [L.subtotal, money(quote.subtotal)],
              ...(Number(quote.discount_total)
                ? [[L.discount, "-" + money(quote.discount_total)]]
                : []),
              ...(Number(quote.tax_total)
                ? [[L.tax, money(quote.tax_total)]]
                : []),
              [L.total, money(quote.total)],
            ];
            const row = e.h / values.length;
            values.forEach(([label, value], i) => {
              const ee = { ...e, y: e.y + i * row, h: row - 1, w: e.w * 0.45 };
              text(label, ee, i === values.length - 1);
              text(
                value,
                { ...ee, x: e.x + e.w * 0.45, w: e.w * 0.55, align: "right" },
                i === values.length - 1,
              );
            });
            continue;
          }
          text(C.resolve(e, quote, context, money, index + 1, pages.length), e);
        }
      });
      doc.end();
    } catch (e) {
      doc.destroy();
      reject(e);
    }
  });
};
