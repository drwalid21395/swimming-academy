/**
 * Freezes the top rows of the first sheet of a written workbook.
 *
 * SheetJS reads panes but does not write them, so `!freeze` on the sheet object is
 * silently dropped on serialisation. The pane definition is injected into the
 * worksheet XML instead, which is the same technique already used for the student
 * template dropdowns.
 */
import { CFB } from "@/lib/xlsx-cfb";

function worksheetPath(cfb: ReturnType<typeof CFB.read>) {
  const direct = cfb.FullPaths.indexOf("/xl/worksheets/sheet1.xml");
  if (direct !== -1) return direct;

  return cfb.FullPaths.findIndex((path: string) =>
    path.replace(/^\//, "").endsWith("worksheets/sheet1.xml"),
  );
}

/**
 * `ySplit` is the number of rows pinned to the top. `topLeftCell` is the first
 * scrolling cell, one row further down, and Excel rejects the pane when the two
 * disagree.
 */
function paneXml(rowsToFreeze: number) {
  const topLeft = `A${rowsToFreeze + 1}`;

  return (
    `<sheetViews><sheetView tabSelected="1" workbookViewId="0">` +
    `<pane ySplit="${rowsToFreeze}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>` +
    `</sheetView></sheetViews>`
  );
}

export function freezeTopRows(buffer: Buffer, rowsToFreeze: number) {
  if (rowsToFreeze <= 0) return buffer;

  const cfb = CFB.read(buffer, { type: "buffer" });
  const index = worksheetPath(cfb);
  const entry = cfb.FileIndex[index];

  if (!entry) throw new Error("تعذر الوصول إلى ورقة العمل داخل ملف الإكسل.");

  let xml = Buffer.from(entry.content).toString("utf8");

  // Replace any existing sheetViews rather than appending a second one: the
  // schema allows only one, and Excel discards the sheet when it finds two.
  if (xml.includes("<sheetViews>")) {
    xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, paneXml(rowsToFreeze));
  } else {
    const sheetPr = xml.indexOf("<sheetPr");
    const dimension = xml.indexOf("<dimension");
    const sheetData = xml.indexOf("<sheetData");

    // `sheetViews` is the third child of `worksheet` per ECMA-376, so it goes
    // after `sheetPr`/`dimension` when they exist and before `sheetData`
    // otherwise.
    const candidates = [dimension, sheetData].filter((at) => at !== -1);
    const insertAt = candidates.length ? Math.min(...candidates) : -1;

    if (insertAt === -1) {
      const close = xml.lastIndexOf("</worksheet>");
      if (close === -1) throw new Error("تعذر تحديد نهاية ورقة العمل في ملف الإكسل.");
      xml = `${xml.slice(0, close)}${paneXml(rowsToFreeze)}${xml.slice(close)}`;
    } else {
      xml = `${xml.slice(0, insertAt)}${paneXml(rowsToFreeze)}${xml.slice(insertAt)}`;
    }
  }

  cfb.FileIndex[index].content = Buffer.from(xml, "utf8");

  const written = CFB.write(cfb, {
    fileType: "zip",
    type: "buffer",
    compression: true,
  });

  return Buffer.isBuffer(written) ? written : Buffer.from(written);
}