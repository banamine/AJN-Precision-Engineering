"""Extra offline checks for the v2 additions (run: python test_workbench_v2_extra.py)."""
import importlib.machinery, importlib.util, shutil, subprocess, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader('workbench_v2', str(HERE / 'AJN_Zip_Workbench_v2.pyw'))
spec = importlib.util.spec_from_loader(loader.name, loader)
w = importlib.util.module_from_spec(spec)
loader.exec_module(w)


class Extra(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.TemporaryDirectory()
        cls.fixture = Path(cls.d.name) / 'fixture.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10',
                        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac',
                        '-movflags', '+faststart', str(cls.fixture)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.d.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / 'out'
        self.cfg = dict(out=str(self.out), remux=True, pause=0, limit=0, items=['item'])
        self.events = []

    def tearDown(self):
        self.tmp.cleanup()

    def fake_download(self, url, dest, cancel, progress):
        shutil.copyfile(self.fixture, dest)
        return True, ''

    def run_job(self, members):
        with patch.object(w, 'list_members', return_value=members), patch.object(w, 'download', side_effect=self.fake_download):
            w.run_job(self.cfg, lambda *a: self.events.append(a), threading.Event())
        return next(e for e in self.events if e[0] == 'done')[1]

    def test_04_end_to_end_summary_collision_and_reports(self):
        members = [dict(zip='a.zip', name='Ep1.mp4', url='u1'), dict(zip='b.zip', name='Ep1.mp4', url='u2'),
                   dict(zip='a.zip', name='Ep1.mp4', url='u3')]  # third duplicates the first path
        summary = self.run_job(members)
        self.assertIn('Completed with failures', summary)
        self.assertIn('Duplicate output path', summary)
        self.assertIn('OK=2', summary)
        run = next((self.out / 'runs').iterdir())
        for name in ('summary.txt', 'run-log.csv', 'playlist.csv', 'workbench.log'):
            self.assertTrue((run / name).exists(), name)
        self.assertEqual((run / 'summary.txt').read_text(encoding='utf-8'), summary)
        self.assertEqual(len((run / 'playlist.csv').read_text(encoding='utf-8-sig').strip().splitlines()), 3)  # header + 2 OK

    def test_05_low_disk_refuses_before_any_work(self):
        with patch.object(w, 'free_bytes', return_value=1024):
            summary = self.run_job([dict(zip='a.zip', name='Ep1.mp4', url='u1')])
        self.assertIn('Failed', summary)
        self.assertIn('GiB free', summary)
        self.assertFalse((self.out / 'runs').exists())

    def test_06_listing_failure_is_reported_not_silent(self):
        def boom(item, log):
            raise RuntimeError('listing exploded')
        with patch.object(w, 'list_members', side_effect=boom):
            w.run_job(self.cfg, lambda *a: self.events.append(a), threading.Event())
        summary = next(e for e in self.events if e[0] == 'done')[1]
        self.assertIn('Failed', summary)
        self.assertIn('listing exploded', summary)
        self.assertTrue(next((self.out / 'runs').iterdir()).joinpath('summary.txt').exists())

    def test_07_headless_exit_codes_and_step_summary(self):
        import os
        step = Path(self.tmp.name) / 'step.md'
        base = ['--headless', '--out', str(self.out), '--limit', '0', '--pause', '0']
        ok_members = [dict(zip='a.zip', name='Ep1.mp4', url='u1')]
        with patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(step)}), \
             patch.object(w, 'list_members', return_value=ok_members), patch.object(w, 'download', side_effect=self.fake_download):
            self.assertEqual(w.headless(base + ['--item', 'item']), 0)
        self.assertIn('Completed', step.read_text(encoding='utf-8'))
        with patch.object(w, 'list_members', return_value=ok_members + ok_members), patch.object(w, 'download', side_effect=self.fake_download):
            self.assertEqual(w.headless(['--headless', '--out', str(Path(self.tmp.name) / 'out2'), '--limit', '0', '--pause', '0', '--item', 'item']), 1)
        with patch.object(w, 'list_members', side_effect=RuntimeError('boom')):
            self.assertEqual(w.headless(['--headless', '--out', str(Path(self.tmp.name) / 'out3'), '--item', 'item']), 3)
        self.assertEqual(w.headless(['--headless', '--out', str(self.out), '--item', 'item', '--limit', '5000']), 3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
