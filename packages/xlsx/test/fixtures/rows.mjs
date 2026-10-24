export function createSheetFixture(rowCount = 200000, sparse = false) {
  return {
    id: 'large', name: 'Large sheet', columnCount: 2, rowCount: sparse ? rowCount * 3 : rowCount,
    rows: Array.from({ length: rowCount }, (_, index) => {
      const row = sparse ? index * 3 + 1 : index + 1;
      return { index: row, cells: [
        { ref: `A${row}`, row, column: 1, value: `Row ${row}` },
        { ref: `B${row}`, row, column: 2, value: String(row * 7) }
      ] };
    })
  };
}
