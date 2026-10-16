const PDFDocument = require("pdfkit"),
  path = require("path");
module.exports = function protocol(project, tasks, notes, orders, user = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
        size: "A4",
        margin: 46,
        bufferPages: true,
        info: {
          Title: project.title + " — project protocol",
          Author: "Klyo",
          Creator: "Klyo CRM",
        },
      }),
      chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(
      "Regular",
      path.join(__dirname, "../assets/fonts/NotoSans-Regular.ttf"),
    );
    doc.registerFont(
      "Bold",
      path.join(__dirname, "../assets/fonts/NotoSans-Bold.ttf"),
    );
    doc.font("Regular");
    const date = (v) => (v ? require("./dealWorkspace").validDate(v) : "—");
    const heading = (t) => {
      if (doc.y > 700) doc.addPage();
      doc
        .moveDown()
        .font("Bold")
        .fontSize(12)
        .fillColor("#233449")
        .text(t)
        .moveDown(0.4)
        .font("Regular")
        .fontSize(9)
        .fillColor("#242a32");
    };
    doc
      .font("Bold")
      .fontSize(22)
      .fillColor("#233449")
      .text("PROJECT PROTOCOL")
      .moveDown(0.4)
      .fontSize(15)
      .text(project.title)
      .moveDown()
      .font("Regular")
      .fontSize(10)
      .fillColor("#242a32")
      .text(`Project #${project.id} · ${project.status} · ${project.kind}`)
      .text(`Period: ${date(project.starts_on)} – ${date(project.due_date)}`)
      .text(
        `Generated: ${new Intl.DateTimeFormat("en-GB", { timeZone: user.time_zone || "UTC" }).format(new Date())}`,
      );
    heading("Scope");
    doc.text(project.description || "No scope recorded.", { lineGap: 3 });
    heading("Milestones and work completed");
    for (const t of tasks)
      doc.text(
        `${t.status === "done" ? "[Completed]" : "[Pending]"} ${t.is_milestone ? "Milestone: " : ""}${t.title} · Due ${date(t.due_date)}`,
        { lineGap: 4 },
      );
    if (!tasks.length) doc.text("No tasks recorded.");
    heading("People and work time");
    const resources = project.resources || [],
      entries = project.time_entries || [];
    doc.text(
      "Logged / planned hours: " +
        entries.reduce((s, t) => s + Number(t.hours), 0).toFixed(2) +
        " / " +
        resources.reduce((s, t) => s + Number(t.planned_hours), 0).toFixed(2) +
        " h",
    );
    for (const r of resources)
      doc.text(
        `${r.user_name}: ${r.role || "Project work"} - planned ${Number(r.planned_hours).toFixed(2)} h`,
        { lineGap: 3 },
      );
    for (const e of entries)
      doc.text(
        `${date(e.spent_on)} - ${e.user_name}: ${Number(e.hours).toFixed(2)} h - ${e.notes || ""}`,
        { lineGap: 3 },
      );
    heading("Order and settlement register");
    for (const o of orders)
      doc.text(
        `${o.number} · ${o.status} · ${o.currency} ${Number(o.total).toFixed(2)} · Paid ${Number(o.paid_amount).toFixed(2)} · Invoice ${o.invoice_number || "not recorded"}`,
        { lineGap: 4 },
      );
    if (!orders.length) doc.text("No orders recorded.");
    heading("Agreements, documentation and protocols");
    for (const n of notes) {
      if (doc.y > 680) doc.addPage();
      doc
        .font("Bold")
        .text(`${n.kind.toUpperCase()} · ${n.title}`)
        .font("Regular")
        .text(n.body || "", { lineGap: 3 });
      if (n.document_url)
        doc
          .fillColor("#345f98")
          .text(n.document_url, { link: n.document_url })
          .fillColor("#242a32");
      doc.moveDown();
    }
    heading("Acceptance");
    doc
      .text("Customer representative: __________________________________")
      .moveDown()
      .text("Date and signature: ________________________________________")
      .moveDown()
      .fontSize(8)
      .fillColor("#667080")
      .text(
        "This document contains CRM records at the time of export. Acceptance requires the customer’s signature.",
      );
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const previousBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Regular")
        .fontSize(8)
        .fillColor("#667080")
        .text(
          `Klyo · Project #${project.id}                                       ${i + 1} / ${range.count}`,
          46,
          806,
          { width: 500, lineBreak: false },
        );
      doc.page.margins.bottom = previousBottom;
    }
    doc.end();
  });
};
