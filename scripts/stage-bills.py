"""Stage only the Bills worksheet for local app review; never modify the workbook."""
import argparse
import json
import os
import re
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import xml.etree.ElementTree as ET


def money(value):
    return str(Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))


def extract(cells, formulas=None):
    formulas = formulas or {}
    records = []
    def add(cell, name, account, frequency, day=None, notes='', kind='bill', amount=None):
        value = cells.get(cell)
        if not isinstance(value, (int, float)) or not name:
            return
        records.append(dict(id=f'Bills!{cell}', name=str(name), accountName=str(account),
                            amount=money(value if amount is None else amount), currency='USD',
                            frequency=frequency, day=day if isinstance(day, int) and 1 <= day <= 31 else None,
                            notes=str(notes), kind=kind, status='review',
                            source=dict(cell=f'Bills!{cell}', value=str(value), formula=formulas.get(cell, ''))))
    for row in range(3, 28):
        note = str(cells.get(f'D{row}', ''))
        frequency, amount = 'Monthly', None
        if '?' in note:
            frequency = 'Unknown'
        else:
            match = re.search(r'\(?\$(\d+(?:\.\d+)?)/3 months', note)
            if match:
                frequency, amount = 'Quarterly', match.group(1)
        add(f'A{row}', cells.get(f'B{row}'), cells.get('A2', ''), frequency,
            cells.get(f'C{row}'), note, amount=amount)
        add(f'E{row}', cells.get(f'F{row}'), cells.get('E2', ''), 'Monthly', notes=cells.get(f'G{row}', ''))
    for row in range(3, 9):
        add(f'N{row}', cells.get(f'O{row}'), '', 'Yearly')
    for row in range(2, 8):
        add(f'Q{row}', cells.get(f'S{row}'), '', 'Monthly', cells.get(f'R{row}'), kind='transfer')
    return records


def read_workbook(path):
    ns = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns)]
        sheets = ET.fromstring(z.read('xl/workbook.xml')).find('m:sheets', ns)
        sheet = next(s for s in sheets if s.attrib['name'] == 'Bills')
        rel_id = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target = next(r.attrib['Target'] for r in rels if r.attrib['Id'] == rel_id)
        target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        cells, formulas = {}, {}
        for c in ET.fromstring(z.read(target)).findall('.//m:sheetData/m:row/m:c', ns):
            ref, typ = c.attrib['r'], c.attrib.get('t')
            v, f = c.find('m:v', ns), c.find('m:f', ns)
            if f is not None:
                formulas[ref] = f.text
            if typ == 'inlineStr':
                cells[ref] = ''.join(c.find('m:is', ns).itertext())
            elif v is not None and v.text:
                if typ == 's': cells[ref] = strings[int(v.text)]
                elif typ in ('str', 'e'): cells[ref] = v.text
                else:
                    number = float(v.text)
                    cells[ref] = int(number) if number.is_integer() else number
        return extract(cells, formulas)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook')
    args = parser.parse_args()
    records = read_workbook(args.workbook)
    destination = Path('data/bills-import.json')
    destination.parent.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(records, out, indent=2)
    destination.chmod(0o600)
    print(f'Staged {len(records)} rows for review. No bills confirmed; workbook unchanged.')
