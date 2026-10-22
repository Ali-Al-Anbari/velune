import ExcelJS from 'exceljs'
import type { EarningsReport } from './reports'
import { DETAIL_COLUMNS, getExportDetailRows, getExportTotals } from './exportData'

const currencyFormat = '$#,##0.00;[Red]-$#,##0.00'
const dollars = (cents: number | null) => cents === null ? null : cents / 100

export function createEarningsWorkbook(report: EarningsReport): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Shifts')
  sheet.columns = [
    { width: 20 }, { width: 14 }, { width: 30 }, { width: 24 }, { width: 16 },
    { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 16 },
  ]
  const header = sheet.addRow([...DETAIL_COLUMNS])
  header.height = 22
  header.font = { bold: true, color: { argb: '202124' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F3F4' } }
  header.border = { bottom: { style: 'thin', color: { argb: 'AEB4BA' } } }

  const rows = [...getExportDetailRows(report), getExportTotals(report)]
  for (const [index, item] of rows.entries()) {
    const row = sheet.addRow([
      item.date, item.start, item.end, item.profile, item.worked,
      dollars(item.hourlyCents), dollars(item.wagesCents), dollars(item.tipsCents),
      dollars(item.taxWithheldCents), dollars(item.totalCents),
    ])
    for (const column of [6, 7, 8, 9, 10]) row.getCell(column).numFmt = currencyFormat
    if (index === rows.length - 1) {
      row.font = { bold: true, color: { argb: '202124' } }
      row.border = { top: { style: 'thin', color: { argb: 'AEB4BA' } } }
    } else if (index % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FAFAFA' } }
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: DETAIL_COLUMNS.length } }
  return workbook
}
