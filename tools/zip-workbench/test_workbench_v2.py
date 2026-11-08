"""Offline v2 regression reproductions. Run: python test_workbench_v2.py"""
import csv
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader('workbench_v2', str(HERE/'AJN_Zip_Workbench_v2.pyw'))
spec = importlib.util.spec_from_loader(loader.name, loader)
w = importlib.util.module_from_spec(spec)
loader.exec_module(w)

class Reproductions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_dir = tempfile.TemporaryDirectory()
        cls.fixture = Path(cls.fixture_dir.name)/'fixture.mp4'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',
            '-f','lavfi','-i','color=c=black:s=64x64:r=10',
            '-f','lavfi','-i','anullsrc=r=44100:cl=mono',
            '-t','1','-c:v','libx264','-c:a','aac','-movflags','+faststart',str(cls.fixture)],check=True)
    @classmethod
    def tearDownClass(cls):
        cls.fixture_dir.cleanup()
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)/'output'
        self.cfg = dict(out=str(self.root), remux=True, pause=0, limit=0, items=['item'])
        self.cancel = threading.Event()
        self.events = []
    def tearDown(self):
        self.tmp.cleanup()
    def member(self, zip='one.zip', name='episode.mp4'):
        return dict(zip=zip,name=name,url='https://example.invalid/member')
    def fake_download(self,url,dest,cancel,progress):
        shutil.copyfile(self.fixture,dest)
        return True,''
    def process(self,m):
        return w.process_member(m,'item',None,self.cfg,self.cancel,lambda *a:self.events.append(a))
    def test_01_collision_cross_volume_publication_and_incremental_logs(self):
        real_rename = os.rename
        publications = []
        def destination_only_rename(src,dst):
            self.assertEqual(Path(src).parent,Path(dst).parent,
                'A cross-directory rename would not prove cross-volume safety')
            self.assertTrue(str(src).endswith('.final.tmp'))
            publications.append(str(dst))
            return real_rename(src,dst)
        with patch.object(w,'download',side_effect=self.fake_download), patch.object(w.os,'rename',side_effect=destination_only_rename):
            a = self.process(self.member('one.zip'))
            b = self.process(self.member('two.zip'))
        self.assertEqual((a['status'],b['status']),('OK','OK'))
        self.assertNotEqual(a['path'],b['path'])
        self.assertNotEqual(a['key'],b['key'])
        self.assertEqual(len(publications),2)
        journal = w.RunJournal(self.root)
        try:
            journal.append(a)
            with open(journal.path/'playlist.csv',encoding='utf-8-sig',newline='') as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(len(rows),1) # visible before close/end-of-run
            self.assertFalse(Path(rows[0]['path']).is_absolute())
            self.assertEqual(rows[0]['archive_url'],'')
            journal.append(b)
            with open(journal.path/'run-log.csv',encoding='utf-8-sig',newline='') as f:
                self.assertEqual(len(list(csv.DictReader(f))),2)
            second = w.RunJournal(self.root)
            self.assertNotEqual(journal.path,second.path)
            second.close()
        finally:
            journal.close()
        for value in ('a:b?.mp4','CON','..','trail.','x/y\\z','a\x01b'):
            clean = w.safe_component(value)
            self.assertFalse(any(c in clean for c in '<>:"/\\|?*'))
            self.assertFalse(any(ord(c)<32 for c in clean))
            self.assertNotIn(clean,('.', '..'))
        self.assertNotEqual(w.safe_component('a:b'),w.safe_component('a?b'))
    def test_02_corrupt_existing_and_verified_skip(self):
        m = self.member()
        target = w.asset_path(self.root,'item',m)
        target.parent.mkdir(parents=True)
        target.write_bytes(b'not an mp4')
        before = target.read_bytes()
        r = self.process(m)
        self.assertEqual(r['status'],'CORRUPT_EXISTING')
        self.assertEqual(target.read_bytes(),before)
        journal = w.RunJournal(self.root)
        try:
            journal.append(r)
            with open(journal.path/'playlist.csv',encoding='utf-8-sig',newline='') as f:
                self.assertEqual(list(csv.DictReader(f)),[])
        finally:
            journal.close()
        shutil.copyfile(self.fixture,target)
        r = self.process(m)
        self.assertEqual(r['status'],'SKIPPED')
        self.assertGreater(r['duration'],0)
    def test_03_cancel_subprocess_cleanup_and_terminal_csv(self):
        m = self.member()
        children = []
        original_popen = subprocess.Popen
        def tracked_popen(*args,**kwargs):
            p = original_popen(*args,**kwargs)
            children.append(p)
            return p
        def blocking_probe(path,cancel):
            w.run_quiet([sys.executable,'-c','import time; time.sleep(60)'],cancel)
        local_temp = Path(self.tmp.name)/'local-temp'
        local_temp.mkdir()
        timer = threading.Timer(0.5,self.cancel.set)
        start = time.monotonic()
        timer.start()
        try:
            with patch.object(w,'download',side_effect=self.fake_download), \
                 patch.object(w,'probe',side_effect=blocking_probe), \
                 patch.object(w.subprocess,'Popen',side_effect=tracked_popen), \
                 patch.object(w.tempfile,'gettempdir',return_value=str(local_temp)):
                r = self.process(m)
        finally:
            timer.cancel()
        self.assertEqual(r['status'],'CANCELLED')
        self.assertLess(time.monotonic()-start,4)
        self.assertTrue(children)
        self.assertTrue(all(p.poll() is not None for p in children))
        self.assertEqual(list(local_temp.iterdir()),[])
        self.assertFalse(w.asset_path(self.root,'item',m).exists())
        journal = w.RunJournal(self.root)
        try:
            journal.append(r)
            with open(journal.path/'run-log.csv',encoding='utf-8-sig',newline='') as f:
                self.assertEqual(next(csv.DictReader(f))['status'],'CANCELLED')
        finally:
            journal.close()

if __name__ == '__main__':
    unittest.main(verbosity=2)
