/* ROOT-Ahead: a small, dependency-free Excel (.xlsx) writer and reader for RA Admin.
   window.XLSXLite.write(book)  → Blob (a real .xlsx: styled header, frozen panes, column widths,
                                   dropdown lists and number checks via data validation, hidden sheets,
                                   defined names, auto filter)
   window.XLSXLite.read(buffer) → Promise<{ names:[sheet names], sheets:{ name: [[cell, …], …] } }>
                                   (reads files saved by Excel, Numbers, LibreOffice and Google Sheets)

   book = { sheets: [ { name, hidden, tab, freeze:{rows, cols}, widths:[…], filter:true,
                        rows: [ [ cell, … ], … ],               cell = value or { v, s } (s = style name)
                        colStyles: [ style name, … ],            default style per column (e.g. 'text')
                        validations: [ { col, from, to, list | min/max/kind, prompt, error, title } ] } ],
            names: [ { name, ref } ] }
   Style names: 'head', 'headReq', 'id', 'text', 'num', 'title', 'body', 'bold', 'note'. */
(function(){
  'use strict';

  /* ---------- helpers ---------- */
  var enc = new TextEncoder();
  function esc(s){
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i){ var s = ''; i++; while (i > 0){ var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(letters){ var n = 0; for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; }

  /* ---------- styles ---------- */
  var STYLE = { def: 0, head: 1, headReq: 2, id: 3, text: 4, num: 5, title: 6, body: 7, bold: 8, note: 9 };
  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="7">' +
      '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF262628"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><sz val="10"/><color rgb="FF8A8A8A"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="18"/><color rgb="FF262628"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF262628"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><i/><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="5">' +
      '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF262628"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFBC120"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F1F1"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="medium"><color rgb="FFFBC120"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                              // def
      '<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +   // head
      '<xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +   // headReq
      '<xf numFmtId="49" fontId="3" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' +             // id
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                                           // text
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                              // num
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                // title
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // body
      '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // bold
      '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // note
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------- sheet XML ---------- */
  function sheetXml(sh, selected){
    var rows = sh.rows || [], maxCol = 0;
    rows.forEach(function(r){ if (r && r.length > maxCol) maxCol = r.length; });
    (sh.widths || []).forEach(function(_, i){ if (i + 1 > maxCol) maxCol = i + 1; });
    var last = colName(Math.max(0, maxCol - 1)) + Math.max(1, rows.length);
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    x += '<sheetPr>' + (sh.tab ? '<tabColor rgb="FF' + sh.tab + '"/>' : '') + '</sheetPr>';
    x += '<dimension ref="A1:' + last + '"/>';
    x += '<sheetViews><sheetView workbookViewId="0"' + (selected ? ' tabSelected="1"' : '') + (sh.zoom ? ' zoomScale="' + sh.zoom + '"' : '') + '>';
    var fr = sh.freeze || {};
    if (fr.rows || fr.cols){
      x += '<pane' + (fr.cols ? ' xSplit="' + fr.cols + '"' : '') + (fr.rows ? ' ySplit="' + fr.rows + '"' : '') +
        ' topLeftCell="' + colName(fr.cols || 0) + ((fr.rows || 0) + 1) + '" activePane="' + (fr.rows && fr.cols ? 'bottomRight' : fr.rows ? 'bottomLeft' : 'topRight') + '" state="frozen"/>';
    }
    x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    if (sh.widths && sh.widths.length){
      x += '<cols>';
      sh.widths.forEach(function(w, i){
        var st = sh.colStyles && sh.colStyles[i] ? ' style="' + STYLE[sh.colStyles[i]] + '"' : '';
        x += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"' + st + '/>';
      });
      x += '</cols>';
    }
    x += '<sheetData>';
    rows.forEach(function(r, ri){
      var ht = sh.rowHeights && sh.rowHeights[ri];
      x += '<row r="' + (ri + 1) + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>';
      (r || []).forEach(function(cell, ci){
        var v = cell, s = sh.colStyles && sh.colStyles[ci] ? sh.colStyles[ci] : null;
        if (cell && typeof cell === 'object'){ v = cell.v; if (cell.s) s = cell.s; }
        var ref = colName(ci) + (ri + 1), sa = s ? ' s="' + STYLE[s] + '"' : '';
        if (v === null || v === undefined || v === ''){ if (s) x += '<c r="' + ref + '"' + sa + '/>'; return; }
        if (typeof v === 'number' && isFinite(v)) x += '<c r="' + ref + '"' + sa + '><v>' + v + '</v></c>';
        else x += '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (sh.filter && rows.length && maxCol) x += '<autoFilter ref="A1:' + colName(maxCol - 1) + Math.max(1, rows.length) + '"/>';
    var vs = sh.validations || [];
    if (vs.length){
      x += '<dataValidations count="' + vs.length + '">';
      vs.forEach(function(v){
        var sq = colName(v.col) + v.from + ':' + colName(v.col) + v.to;
        var a = ' allowBlank="1" showInputMessage="1" showErrorMessage="1"' +
          (v.title ? ' promptTitle="' + esc(v.title).slice(0, 32) + '" errorTitle="' + esc(v.title).slice(0, 32) + '"' : '') +
          (v.prompt ? ' prompt="' + esc(v.prompt).slice(0, 255) + '"' : '') +
          (v.error ? ' error="' + esc(v.error).slice(0, 255) + '"' : '');
        if (v.list) x += '<dataValidation type="list"' + a + ' sqref="' + sq + '"><formula1>' + esc(v.list) + '</formula1></dataValidation>';
        else if (v.kind) x += '<dataValidation type="' + v.kind + '" operator="between"' + a + ' sqref="' + sq + '"><formula1>' + v.min + '</formula1><formula2>' + v.max + '</formula2></dataValidation>';
        else x += '<dataValidation' + a + ' sqref="' + sq + '"/>';   // just the helpful prompt
      });
      x += '</dataValidations>';
    }
    x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
    x += '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
    return x + '</worksheet>';
  }

  /* ---------- zip (stored, no compression: Excel reads this fine) ---------- */
  var CRC = (function(){ var t = new Uint32Array(256); for (var n = 0; n < 256; n++){ var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b){ var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files){
    var parts = [], central = [], offset = 0, now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(function(f){
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cSize = central.reduce(function(n, p){ return n + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cSize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- write ---------- */
  function write(book){
    var sheets = book.sheets, n = sheets.length, firstVisible = 0;
    for (var i = 0; i < n; i++) if (!sheets[i].hidden){ firstVisible = i; break; }
    var activeIdx = typeof book.active === 'number' ? book.active : firstVisible;
    var files = [];
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>';
    sheets.forEach(function(_, i){ ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; });
    files.push({ name: '[Content_Types].xml', data: ct + '</Types>' });
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' });
    var iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    files.push({ name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(book.title || 'ROOT Ahead') + '</dc:title><dc:creator>RA Admin</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified></cp:coreProperties>' });
    files.push({ name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>RA Admin</Application></Properties>' });
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<workbookPr/><bookViews><workbookView activeTab="' + activeIdx + '" firstSheet="0"/></bookViews><sheets>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    sheets.forEach(function(sh, i){
      wb += '<sheet name="' + esc(sh.name) + '" sheetId="' + (i + 1) + '"' + (sh.hidden ? ' state="hidden"' : '') + ' r:id="rId' + (i + 1) + '"/>';
      rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sh, i === activeIdx) });
    });
    wb += '</sheets>';
    var names = (book.names || []).slice();
    sheets.forEach(function(sh, i){
      if (sh.filter && sh.rows && sh.rows.length){
        var mc = 0; sh.rows.forEach(function(r){ if (r.length > mc) mc = r.length; });
        names.push({ name: '_xlnm._FilterDatabase', local: i, hidden: true, ref: "'" + sh.name.replace(/'/g, "''") + "'!$A$1:$" + colName(mc - 1) + '$' + sh.rows.length });
      }
    });
    if (names.length){
      wb += '<definedNames>';
      names.forEach(function(d){ wb += '<definedName name="' + d.name + '"' + (typeof d.local === 'number' ? ' localSheetId="' + d.local + '"' : '') + (d.hidden ? ' hidden="1"' : '') + '>' + esc(d.ref) + '</definedName>'; });
      wb += '</definedNames>';
    }
    wb += '</workbook>';
    rels += '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    files.push({ name: 'xl/workbook.xml', data: wb });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: rels });
    files.push({ name: 'xl/styles.xml', data: STYLES_XML });
    return zip(files);
  }

  /* ---------- read ---------- */
  async function inflate(bytes){
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open Excel files. Use a recent Chrome, Edge, Safari or Firefox.');
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf){
    var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--){ if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
    if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), out = {}, dec = new TextDecoder();
    for (var k = 0; k < count; k++){
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged.');
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
          xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      out[name] = { method: method, csize: csize, loff: loff };
      p += 46 + nlen + xlen + clen;
    }
    return {
      has: function(n){ return !!out[n]; },
      text: async function(n){
        var e = out[n]; if (!e) return null;
        var start = e.loff + 30 + dv.getUint16(e.loff + 26, true) + dv.getUint16(e.loff + 28, true);
        var raw = u8.subarray(start, start + e.csize);
        var data = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
        if (!data) throw new Error('The Excel file uses an unknown compression.');
        return dec.decode(data);
      }
    };
  }
  function xml(t){ return new DOMParser().parseFromString(t, 'application/xml'); }
  function all(node, tag){ return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag)); }
  function textOf(node){ // all <t> inside, skipping phonetic runs
    return all(node, 't').filter(function(t){ var p = t.parentNode; return !(p && p.localName === 'rPh'); }).map(function(t){ return t.textContent; }).join('');
  }
  async function read(buf){
    var z = await unzip(buf);
    if (!z.has('xl/workbook.xml')) throw new Error('This is not an Excel workbook (.xlsx).');
    var wb = xml(await z.text('xl/workbook.xml')), rels = xml(await z.text('xl/_rels/workbook.xml.rels') || '<x/>');
    var relMap = {}; all(rels, 'Relationship').forEach(function(r){ relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    var shared = [];
    var sst = await z.text('xl/sharedStrings.xml');
    if (sst) shared = all(xml(sst), 'si').map(textOf);
    var result = { names: [], sheets: {} };
    var sheetEls = all(wb, 'sheet');
    for (var i = 0; i < sheetEls.length; i++){
      var el = sheetEls[i], name = el.getAttribute('name');
      var rid = el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || el.getAttribute('r:id');
      var target = relMap[rid]; if (!target) continue;
      var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      var sx = await z.text(path); if (!sx) continue;
      var doc = xml(sx), rows = [];
      all(doc, 'row').forEach(function(row){
        var rIdx = parseInt(row.getAttribute('r'), 10) - 1, arr = [], ci = 0;
        all(row, 'c').forEach(function(c){
          var ref = c.getAttribute('r'); if (ref){ var m = /^([A-Z]+)/.exec(ref); if (m) ci = colIndex(m[1]); }
          var t = c.getAttribute('t'), vEl = all(c, 'v')[0], v = vEl ? vEl.textContent : null, val = null;
          if (t === 's') val = v != null ? shared[parseInt(v, 10)] : null;
          else if (t === 'inlineStr') val = textOf(c);
          else if (t === 'str') val = v;
          else if (t === 'b') val = v === '1';
          else if (t === 'e') val = null;
          else if (v != null && v !== '') val = Number(v);
          arr[ci] = val; ci++;
        });
        rows[isNaN(rIdx) ? rows.length : rIdx] = arr;
      });
      for (var r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = [];
      result.names.push(name); result.sheets[name] = rows;
    }
    return result;
  }

  // Excel date serial number → 'YYYY-MM-DD'
  function serialToIso(n){ var d = new Date(Math.round((n - 25569) * 86400000)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }

  window.XLSXLite = { write: write, read: read, colName: colName, serialToIso: serialToIso };
})();
