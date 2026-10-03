import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateWorkbook, templateValidations } from '../services/templateService.js';

test('template has dropdown validations on rows 2-501 and a Lists sheet of current active names', async () => {
  const wb = await buildTemplateWorkbook({
    departments: [{ name: 'Youth' }, { name: 'Old', active: false }, { name: 'Education' }],
    venues: [{ name: 'Main Hall' }]
  });
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Bookings', 'Lists', 'Instructions']);
  const ws = wb.getWorksheet('Bookings');
  const v = templateValidations(2, 1);
  assert.equal(v.length, 5);
  for (const { col, source } of v) {
    for (const r of [2, 501]) {
      const dv = ws.getCell(r, col).dataValidation;
      assert.equal(dv.type, 'list');
      assert.equal(dv.formulae[0], source);
    }
    assert.equal(ws.getCell(502, col).dataValidation, undefined);
  }
  const lists = wb.getWorksheet('Lists');
  assert.deepEqual([lists.getCell('A2').value, lists.getCell('A3').value, lists.getCell('B2').value], ['Education', 'Youth', 'Main Hall']);
  assert.match(String(wb.getWorksheet('Instructions').getCell('A4').value), /DD\/MM\/YYYY/);
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(buf.byteLength > 1000);
});
