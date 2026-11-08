import importlib.util, unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('stage_bills', Path(__file__).parents[1] / 'scripts/stage-bills.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class BillsTest(unittest.TestCase):
    def test_extract(self):
        rows = mod.extract({'A2':'Checking','A3':100,'B3':'Rent','C3':1,'A6':9,'B6':'Xbox','D6':'($27/3 months)','A12':18,'B12':'Life','D12':'every 3 months?','E2':'Other','E4':0,'F4':'Car','N3':40,'O3':'App','Q2':100,'R2':28,'S2':'Rent'})
        byid = {r['id']:r for r in rows}
        self.assertEqual(byid['Bills!A3']['amount'], '100.00')
        self.assertEqual(byid['Bills!A6']['frequency'],'Quarterly')
        self.assertEqual(byid['Bills!A6']['amount'],'27.00')
        self.assertEqual(byid['Bills!A12']['frequency'],'Unknown')
        self.assertEqual(byid['Bills!E4']['amount'],'0.00')
        self.assertEqual(byid['Bills!N3']['accountName'],'')
        self.assertEqual(byid['Bills!N3']['frequency'],'Yearly')
        self.assertEqual(byid['Bills!Q2']['kind'],'transfer')
        self.assertEqual(len(rows),6)
if __name__ == '__main__': unittest.main()
