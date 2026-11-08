#!/usr/bin/env python3
"""AJN Zip Workbench v2. Local temporary processing; verified publication.
Media: <output>/<sanitized item>/<sanitized zip stem>/<sanitized member>.
Reports: <output>/runs/YYYYMMDD_HHMMSS[/suffix] (unique run directory).
Requires ffprobe for all runs and ffmpeg for copy-remux mode.
No upload API; a Drive-synced destination may be synced by Drive desktop.

No-window mode (used by GitHub Actions; needs no tkinter):
  python AJN_Zip_Workbench_v2.pyw --headless (--item <archive-id> | --playlist file.m3u) [...] --out <folder> [--limit N] [--pause S] [--no-remux]
  exit code 0 = completed, 1 = completed with failures, 2 = cancelled, 3 = failed
"""
import csv, datetime as dt, json, os, queue, re, shutil, subprocess, sys, threading, time
import urllib.parse, urllib.request
from pathlib import Path

BASE = os.environ.get("AJN_ARCHIVE_BASE", "https://archive.org")   # test hook only: point at a local mock server
UA = {"User-Agent": "ajn-zip-workbench/1.0"}
CFG_PATH = Path.home() / ".ajn_zip_workbench.json"
NO_WIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DEFAULT_ITEM = "stargate-atlantis-s05-2008-eng-cc1-captions"


# ----------------------------------------------------------------------------- core (no UI)
def http_get(url, timeout=90):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def parse_item(text):
    t = text.strip()
    if not t:
        return ""
    m = re.search(r"archive\.org/(?:details|download|metadata)/([^/?#\s]+)", t)
    return urllib.parse.unquote(m.group(1)) if m else t.split()[0]


def search_items(query, rows=40):
    q = urllib.parse.quote(query)
    url = (f"{BASE}/advancedsearch.php?q={q}&fl[]=identifier&fl[]=title&rows={rows}&output=json&sort[]=downloads+desc")
    docs = json.loads(http_get(url, 60))["response"]["docs"]
    return [(d.get("identifier", ""), d.get("title", "")) for d in docs]


def list_members(item, log):
    meta = json.loads(http_get(f"{BASE}/metadata/{urllib.parse.quote(item)}", 60))
    zips = sorted(f["name"] for f in meta.get("files", []) if f.get("name", "").lower().endswith(".zip"))
    if not zips:
        raise RuntimeError(f"No .zip files in item {item}")
    log(f"{item}: {len(zips)} zip file(s)")
    out = []
    for z in zips:
        html = http_get(f"{BASE}/download/{urllib.parse.quote(item)}/{urllib.parse.quote(z)}/", 90).decode("utf-8", "replace")
        for h in sorted(set(re.findall(r'href="((?://archive\.org|/download)[^"]*?\.mp4)"', html))):
            url = ("https:" + h) if h.startswith("//") else (BASE + h if h.startswith("/") else h)
            out.append({"zip": z, "name": urllib.parse.unquote(h.rsplit("/", 1)[-1]), "url": url})
    out.sort(key=lambda m: m["name"])
    log(f"{item}: {len(out)} .mp4 member(s)")
    return out


def members_from_playlist(path):
    """Read an .m3u of archive.org zip-member links -> {item: [member, ...]} (no network, no Archive listing page)."""
    out, bad = {}, 0
    for line in Path(path).read_text(encoding="utf-8-sig", errors="replace").splitlines():
        u = line.strip()
        if not u or u.startswith("#"):
            continue
        m = re.match(r"https?://archive\.org/download/([^/]+)/([^/]+\.zip)/([^/?#]+\.mp4)$", u, re.I)
        if not m:
            bad += 1
            continue
        item, z, name = (urllib.parse.unquote(x) for x in m.groups())
        out.setdefault(item, []).append({"zip": z, "name": name, "url": u})
    for v in out.values():
        v.sort(key=lambda x: x["name"])
    if not out:
        raise ValueError(f"{path}: no archive.org zip-member .mp4 links found ({bad} other line(s))")
    return out


def moov_first(path):
    total = os.path.getsize(path)
    with open(path, "rb") as f:
        pos = 0
        for _ in range(40):
            if pos >= total:
                return False
            f.seek(pos)
            h = f.read(16)
            if len(h) < 8:
                return False
            size, typ = int.from_bytes(h[:4], "big"), h[4:8].decode("ascii", "replace")
            if typ == "moov":
                return True
            if typ == "mdat":
                return False
            if size == 1 and len(h) >= 16:
                size = int.from_bytes(h[8:16], "big")
            if size < 8:
                return False
            pos += size
    return False


class Cancelled(Exception):
    pass


def download(url, dest, cancel, progress, tries=4):
    last_err = "unknown"
    for n in range(1, tries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r, open(dest, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                while True:
                    if cancel.is_set():
                        raise Cancelled()
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
                    got += len(b)
                    progress(got, total)
            if total and got != total:
                raise IOError(f"short read {got}/{total}")
            return True, ""
        except Cancelled:
            raise
        except Exception as e:  # noqa: BLE001 - reported as FAILED detail
            last_err = f"{type(e).__name__}: {e}"
            for _ in range(15):
                if cancel.is_set():
                    raise Cancelled()
                time.sleep(1)
    return False, last_err


def clean_title(stem):
    return re.sub(r"\s+", " ", re.sub(r"[._]+", " ", stem)).strip()


def fmt_secs(s):
    s = int(s)
    return f"{s // 3600}h {s % 3600 // 60:02d}m {s % 60:02d}s" if s >= 3600 else f"{s // 60}m {s % 60:02d}s"



import tempfile
import hashlib
import math

def safe_component(value):
    original = str(value)
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', '', original).strip().rstrip('. ')
    if not clean or clean in ('.', '..'):
        clean = 'unnamed'
    if clean.split('.')[0].upper() in {'CON','PRN','AUX','NUL', *('COM'+str(i) for i in range(1,10)), *('LPT'+str(i) for i in range(1,10))}:
        clean = '_' + clean
    if clean != original or len(clean) > 100:
        clean = clean[:85] + '-' + hashlib.sha256(original.encode()).hexdigest()[:10]
    return clean

def asset_path(root, item, member):
    zip_name = str(member['zip'])
    zip_stem = zip_name[:-4] if zip_name.lower().endswith('.zip') else zip_name
    return Path(root) / safe_component(item) / safe_component(zip_stem) / safe_component(member['name'])

def run_quiet(cmd, cancel=None, timeout=1800):
    cancel = cancel or threading.Event()
    if cancel.is_set():
        raise Cancelled()
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        proc = subprocess.Popen(cmd, stdout=stdout, stderr=stderr, creationflags=NO_WIN)
        started = time.monotonic()
        try:
            while proc.poll() is None:
                if cancel.wait(0.25):
                    raise Cancelled()
                if time.monotonic() - started > timeout:
                    raise TimeoutError('Subprocess deadline exceeded')
            if cancel.is_set():
                raise Cancelled()
            stdout.seek(0)
            stderr.seek(0)
            return subprocess.CompletedProcess(cmd, proc.returncode,
                stdout.read().decode('utf-8', 'replace'),
                stderr.read(262144).decode('utf-8', 'replace'))
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()

def probe(path, cancel=None):
    result = run_quiet(['ffprobe', '-v', 'error', '-print_format', 'json',
        '-show_format', '-show_streams', str(path)], cancel, timeout=120)
    if result.returncode:
        return None
    try:
        return json.loads(result.stdout)
    except (ValueError, TypeError):
        return None

def valid_media(data):
    try:
        duration = float(data['format']['duration'])
        video = any(x.get('codec_type') == 'video' and x.get('codec_name')
                    for x in data['streams'])
        return math.isfinite(duration) and duration > 0 and video
    except (TypeError, KeyError, ValueError):
        return False

def publish_verified(source, final, cancel):
    final.parent.mkdir(parents=True, exist_ok=True)
    staged = final.with_name(final.name + '.final.tmp')
    if final.exists() or staged.exists():
        raise FileExistsError('Destination or staging file already exists; refusing overwrite')
    try:
        # Copy across volumes in cancellable chunks; rename only within destination.
        with open(source, 'rb') as src, open(staged, 'xb') as dst:
            while True:
                if cancel.is_set():
                    raise Cancelled()
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        if cancel.is_set():
            raise Cancelled()
        if final.exists():
            raise FileExistsError('Target appeared during publication')
        os.rename(staged, final)
    finally:
        staged.unlink(missing_ok=True)

def process_member(m, item, out_dir, cfg, cancel, ev):
    final = asset_path(cfg['out'], item, m)
    key = final.relative_to(Path(cfg['out'])).as_posix()
    res = dict(item=item, zip=m['zip'], file=m['name'], title=clean_title(Path(m['name']).stem),
        url=m['url'], path=key, archive_url='', key=key, status='FAILED', t_download=0.0,
        t_remux=0.0, t_total=0.0, bytes=0, duration=0.0, detail='')
    start = time.monotonic()
    ev('row', {**res, 'status':'RUNNING'})
    try:
        if cancel.is_set():
            raise Cancelled()
        if final.exists():
            data = probe(final, cancel)
            if not valid_media(data):
                res.update(status='CORRUPT_EXISTING', detail='Existing target failed probe; not modified')
            else:
                res.update(status='SKIPPED', bytes=final.stat().st_size,
                    duration=float(data['format']['duration']), detail='Existing target verified: positive duration and video')
            return res
        with tempfile.TemporaryDirectory(prefix='ajn-v2-', dir=tempfile.gettempdir()) as work:
            raw, part = Path(work)/'raw.mp4', Path(work)/'verified.mp4'
            ev('stage', m['name'], 'downloading to local temporary storage')
            t = time.monotonic()
            ok, error = download(m['url'], raw, cancel, lambda got,total: ev('dl',m['name'],got,total))
            res['t_download'] = round(time.monotonic()-t, 2)
            if not ok:
                raise RuntimeError(error)
            original = probe(raw, cancel)
            if not valid_media(original):
                raise RuntimeError('Downloaded file failed local probe')
            candidate = raw
            if cfg['remux']:
                ev('stage', m['name'], 'remuxing locally')
                t = time.monotonic()
                result = run_quiet(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
                    '-i',str(raw),'-map','0:v:0','-map','0:a:0','-map_chapters','-1','-dn','-sn',
                    '-c','copy','-movflags','+faststart','-f','mp4',str(part)], cancel)
                res['t_remux'] = round(time.monotonic()-t,2)
                if result.returncode:
                    raise RuntimeError('ffmpeg: '+result.stderr[:500])
                candidate = part
            data = probe(candidate, cancel)
            if not valid_media(data):
                raise RuntimeError('Final local probe failed')
            duration = float(data['format']['duration'])
            if cfg['remux']:
                codecs = sorted(x.get('codec_name','?') for x in data['streams'])
                if codecs != ['aac','h264'] or abs(duration-float(original['format']['duration'])) > 2 or not moov_first(candidate):
                    raise RuntimeError('Codec, duration or faststart verification failed')
            ev('stage',m['name'],'publishing verified file')
            publish_verified(candidate, final, cancel)
            res.update(status='OK' if cfg['remux'] else 'DOWNLOADED', bytes=final.stat().st_size,
                duration=duration, detail='Locally verified; published without re-encoding')
    except Cancelled:
        res.update(status='CANCELLED', detail='Cancelled; temporary work cleaned')
    except Exception as error:
        res.update(status='FAILED', detail=f'{type(error).__name__}: {error}')
    finally:
        res['t_total'] = round(time.monotonic()-start, 2)
    return res

FIELDS = ['item','zip','file','title','path','archive_url','url','status','duration','bytes',
          't_download','t_remux','t_total','detail']

class RunJournal:
    def __init__(self, root):
        runs = Path(root)/'runs'
        runs.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now().strftime('%Y%m%d_%H%M%S')
        self.path = runs/stamp
        suffix = 0
        while True:
            try:
                self.path.mkdir()
                break
            except FileExistsError:
                suffix += 1
                self.path = runs/f'{stamp}_{suffix:02d}'
        self.files = []
        self.writers = []
        for name in ('run-log.csv','playlist.csv'):
            f = open(self.path/name,'w',newline='',encoding='utf-8-sig')
            self.files.append(f)
            w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
            w.writeheader()
            self.writers.append(w)
        self.flush()
    def flush(self):
        for f in self.files:
            f.flush()
            os.fsync(f.fileno())
    def append(self, result):
        self.writers[0].writerow(result)
        if result['status'] in ('OK','SKIPPED','DOWNLOADED'):
            self.writers[1].writerow(result)
        self.flush()
    def close(self):
        for f in self.files:
            f.close()

MIN_FREE = 2 * 1024 ** 3   # refuse to start with less than 2 GiB free (one episode is ~0.5 GB, raw + remux copy)

def ensure_ffmpeg_on_path():
    """Explorer-launched apps can miss a freshly installed winget ffmpeg. Look in the winget folder and extend PATH."""
    if shutil.which('ffprobe') and shutil.which('ffmpeg'):
        return True
    local = os.environ.get('LOCALAPPDATA')
    if local:
        import glob
        for exe in glob.glob(os.path.join(local, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg*', '**', 'bin', 'ffprobe.exe'), recursive=True):
            os.environ['PATH'] = os.path.dirname(exe) + os.pathsep + os.environ.get('PATH', '')
            break
    return bool(shutil.which('ffprobe') and shutil.which('ffmpeg'))

def free_bytes(path):
    p = Path(path)
    while not p.exists() and p != p.parent:
        p = p.parent
    return shutil.disk_usage(p).free

def collision_result(m, item, cfg, first_zip):
    key = asset_path(cfg['out'], item, m).relative_to(Path(cfg['out'])).as_posix()
    return dict(item=item, zip=m['zip'], file=m['name'], title=clean_title(Path(m['name']).stem), url=m['url'],
        path=key, archive_url='', key=key, status='FAILED', t_download=0.0, t_remux=0.0, t_total=0.0, bytes=0,
        duration=0.0, detail=f'Duplicate output path (same as an earlier member from {first_zip}); not downloaded')

def build_summary(outcome, results, counts, started, finished, cfg, notes, run_dir):
    done = [r for r in results if r['status'] in ('OK', 'SKIPPED', 'DOWNLOADED')]
    bad = [r for r in results if r['status'] in ('FAILED', 'CORRUPT_EXISTING')]
    work = [r for r in results if r['status'] in ('OK', 'DOWNLOADED')]
    avg = sum(r['t_total'] for r in work) / len(work) if work else 0
    L = ['AJN ZIP WORKBENCH v2 - RUN SUMMARY', outcome, '=' * 40,
         f'Started : {started:%Y-%m-%d %H:%M:%S}', f'Finished: {finished:%Y-%m-%d %H:%M:%S}',
         f'Elapsed : {fmt_secs((finished - started).total_seconds())}', f'Output  : {cfg["out"]}', f'Reports : {run_dir}',
         'Mode    : ' + ('download + faststart remux (copy, no re-encode)' if cfg['remux'] else 'download only (NOT remuxed; may not seek)'), '',
         'Counts  : ' + (', '.join(f'{k}={v}' for k, v in sorted(counts.items())) or 'none'),
         f'Size    : {sum(r["bytes"] for r in done) / 1e9:.2f} GB   Play time: {fmt_secs(sum(r["duration"] for r in done))}',
         f'Timing  : avg {fmt_secs(avg)} per processed file; download {sum(r["t_download"] for r in results):.0f}s, remux {sum(r["t_remux"] for r in results):.0f}s in total', '']
    for r in results:
        L.append(f'  {r["status"]:<16} {r["path"]}  dl {r["t_download"]}s  remux {r["t_remux"]}s  total {r["t_total"]}s  {r["bytes"] / 1e6:.0f} MB')
    if bad:
        L += ['', 'FAILURES (nothing was hidden or re-encoded):'] + [f'  {r["path"]}: {r["detail"]}' for r in bad]
    if notes:
        L += ['', 'NOTES:'] + [f'  {n}' for n in notes]
    L += ['', 'playlist.csv = verified files only; run-log.csv = every file with timings. Nothing was uploaded.']
    return '\n'.join(L) + '\n'

def run_job(cfg, emit, cancel):
    journal, results, counts, notes = None, [], {}, []
    started = dt.datetime.now()
    outcome = 'Failed'
    try:
        if not ensure_ffmpeg_on_path() and (not shutil.which('ffprobe') or cfg['remux']):
            raise RuntimeError('ffprobe is required; ffmpeg is also required for remux mode')
        for label, where in (('output folder', cfg['out']), ('local temp folder', tempfile.gettempdir())):
            if free_bytes(where) < MIN_FREE:
                raise RuntimeError(f'Less than {MIN_FREE // 1024 ** 3} GiB free on the {label}: {where}')
        journal = RunJournal(cfg['out'])
        emit('runpath', str(journal.path))
        with open(journal.path/'workbench.log','a',encoding='utf-8') as logf:
            def log(msg):
                logf.write(msg+'\n'); logf.flush(); emit('log',msg)
            plan = []
            for item in cfg['items']:
                if cancel.is_set(): break
                try:
                    members = cfg.get('members', {}).get(item) or list_members(item,log)
                    plan.extend((item,m) for m in (members[:cfg['limit']] if cfg['limit'] else members))
                except Exception as error:
                    log(f'Listing failed {item}: {error}')
                    notes.append(f'{item}: listing failed: {error}')
            if not plan and not cancel.is_set():
                raise RuntimeError('Nothing to process: ' + ('; '.join(notes) or 'no members found'))
            emit('total',len(plan))
            seen = {}
            for i,(item,m) in enumerate(plan,1):
                if cancel.is_set(): break
                pkey = asset_path(cfg['out'], item, m).relative_to(Path(cfg['out'])).as_posix()
                if pkey in seen:
                    r = collision_result(m, item, cfg, seen[pkey])
                else:
                    seen[pkey] = m['zip']
                    r = process_member(m,item,None,cfg,cancel,emit)
                journal.append(r)
                results.append(r)
                counts[r['status']] = counts.get(r['status'],0)+1
                emit('row',r); emit('progress',i)
                log(f"{r['path']} {r['status']}: {r['detail']}")
                if r['status']=='CANCELLED' or cancel.wait(cfg['pause'] if i<len(plan) else 0): break
            outcome = 'Cancelled' if cancel.is_set() else ('Completed with failures' if any(counts.get(x) for x in ('FAILED','CORRUPT_EXISTING')) or notes else 'Completed')
    except Exception as error:
        outcome = 'Failed'
        notes.append(f'{type(error).__name__}: {error}')
    finally:
        summary = build_summary(outcome, results, counts, started, dt.datetime.now(), cfg, notes, journal.path if journal else '(no run folder)')
        if journal:
            try:
                (journal.path/'summary.txt').write_text(summary,encoding='utf-8')
            except OSError as error:
                summary += f'\nWARNING: summary.txt could not be saved: {error}\n'
            journal.close()
        emit('done',summary)


# ----------------------------------------------------------------------------- UI
def open_path(p):
    try:
        if sys.platform.startswith("win"):
            os.startfile(p)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(p)])
        else:
            subprocess.Popen(["xdg-open", str(p)])
    except Exception:  # noqa: BLE001
        pass


def build_ui():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    NAVY, NAVY2, GOLD, CREAM = "#0b1f4a", "#14306b", "#e0b33a", "#f4f1e6"
    root = tk.Tk()
    root.title("AJN Zip Workbench v2")
    root.geometry("1040x720")
    root.minsize(900, 620)
    root.configure(bg=NAVY)
    st = ttk.Style(root)
    st.theme_use("clam")
    st.configure(".", font=("Segoe UI", 10))
    st.configure("TFrame", background=CREAM)
    st.configure("TLabel", background=CREAM)
    st.configure("TNotebook", background=NAVY, borderwidth=0)
    st.configure("TNotebook.Tab", padding=(18, 8), font=("Segoe UI", 10, "bold"))
    st.map("TNotebook.Tab", background=[("selected", GOLD)], foreground=[("selected", NAVY)])
    st.configure("Gold.TButton", background=GOLD, foreground=NAVY, font=("Segoe UI", 10, "bold"), padding=8)
    st.map("Gold.TButton", background=[("active", "#f0c85a"), ("disabled", "#cfc9b0")])
    st.configure("TButton", padding=6)
    st.configure("Treeview", rowheight=24)
    st.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))
    st.configure("Horizontal.TProgressbar", troughcolor="#d8d4c4", background=NAVY2)

    head = tk.Frame(root, bg=NAVY)
    head.pack(fill="x")
    tk.Label(head, text="AJN ZIP WORKBENCH", bg=NAVY, fg=GOLD, font=("Segoe UI", 18, "bold")).pack(side="left", padx=18, pady=10)
    tk.Label(head, text="find  >  download  >  fix for seeking  >  playlist.csv", bg=NAVY, fg=CREAM,
             font=("Segoe UI", 10)).pack(side="left", pady=14)

    nb = ttk.Notebook(root)
    nb.pack(fill="both", expand=True, padx=10, pady=(0, 10))
    t_in, t_run, t_res = ttk.Frame(nb, padding=14), ttk.Frame(nb, padding=14), ttk.Frame(nb, padding=14)
    nb.add(t_in, text="1  Input")
    nb.add(t_run, text="2  Run")
    nb.add(t_res, text="3  Results")

    cfg0 = {"out": "", "items": DEFAULT_ITEM, "limit": 1, "remux": True, "pause": 5}
    try:
        cfg0.update(json.loads(CFG_PATH.read_text(encoding="utf-8")))
    except Exception:  # noqa: BLE001
        pass
    have_ff = ensure_ffmpeg_on_path()

    # ---- Input tab
    ttk.Label(t_in, text="Archive.org items (one per line - an id or a details/download link)",
              font=("Segoe UI", 10, "bold")).grid(row=0, column=0, columnspan=3, sticky="w")
    items_box = tk.Text(t_in, height=5, font=("Consolas", 10), relief="solid", bd=1)
    items_box.grid(row=1, column=0, columnspan=3, sticky="ew", pady=(4, 10))
    items_box.insert("1.0", cfg0["items"])

    ttk.Label(t_in, text="Search Archive.org (optional)", font=("Segoe UI", 10, "bold")).grid(row=2, column=0, sticky="w")
    q_var = tk.StringVar()
    q_entry = ttk.Entry(t_in, textvariable=q_var)
    q_entry.grid(row=3, column=0, sticky="ew", pady=(4, 6))
    res_list = tk.Listbox(t_in, height=7, selectmode="extended", font=("Consolas", 9), relief="solid", bd=1)
    res_list.grid(row=4, column=0, columnspan=3, sticky="ew")
    found = []

    search_generation = [0]
    def do_search():
        search_generation[0] += 1
        generation = search_generation[0]
        query = q_var.get() or "mediatype:movies"
        res_list.delete(0, "end")
        res_list.insert("end", "Searching...")
        found.clear()
        def worker():
            try:
                state["q"].put(("search", generation, search_items(query), ""))
            except Exception as error:
                state["q"].put(("search", generation, [], str(error)))
        threading.Thread(target=worker, daemon=True).start()

    def add_selected():
        for i in res_list.curselection():
            if i >= len(found):
                continue
            cur = items_box.get("1.0", "end").strip()
            if found[i] not in {parse_item(x) for x in cur.splitlines() if x.strip()}:
                items_box.insert("end", ("" if not cur else "\n") + found[i])

    ttk.Button(t_in, text="Search", command=do_search).grid(row=3, column=1, padx=6)
    ttk.Button(t_in, text="Add selected to list", command=add_selected).grid(row=3, column=2)
    q_entry.bind("<Return>", lambda e: do_search())

    ttk.Label(t_in, text="Output folder (inside your Google Drive for desktop folder to sync)",
              font=("Segoe UI", 10, "bold")).grid(row=5, column=0, columnspan=3, sticky="w", pady=(14, 0))
    out_var = tk.StringVar(value=cfg0["out"])
    ttk.Entry(t_in, textvariable=out_var).grid(row=6, column=0, columnspan=2, sticky="ew", pady=4)
    ttk.Button(t_in, text="Browse...", command=lambda: out_var.set(filedialog.askdirectory() or out_var.get())
               ).grid(row=6, column=2, padx=(6, 0))

    opt = ttk.Frame(t_in)
    opt.grid(row=7, column=0, columnspan=3, sticky="w", pady=(10, 0))
    remux_var = tk.BooleanVar(value=cfg0["remux"] and have_ff)
    remux_chk = ttk.Checkbutton(opt, text="Fix for seeking (ffmpeg copy, no re-encode)", variable=remux_var,
                                state="normal" if have_ff else "disabled")
    remux_chk.pack(side="left")
    limit_var, pause_var = tk.IntVar(value=cfg0["limit"]), tk.IntVar(value=cfg0["pause"])
    ttk.Label(opt, text="   Episodes per item (0 = all):").pack(side="left")
    ttk.Spinbox(opt, from_=0, to=999, width=5, textvariable=limit_var).pack(side="left")
    ttk.Label(opt, text="   Pause between files (s):").pack(side="left")
    ttk.Spinbox(opt, from_=0, to=120, width=4, textvariable=pause_var).pack(side="left")
    msg = ("ffmpeg + ffprobe found." if have_ff else
           "ffmpeg/ffprobe not both found. ffprobe is required for every run. Install FFmpeg and reopen.")
    ff_lbl = ttk.Label(t_in, text=msg, foreground="#1d6b2f" if have_ff else "#a33")
    ff_lbl.grid(row=8, column=0, columnspan=2, sticky="w", pady=6)
    def recheck_ffmpeg():
        ok = ensure_ffmpeg_on_path()
        ff_lbl.configure(text="ffmpeg + ffprobe found." if ok else "ffmpeg/ffprobe still not found. Install FFmpeg (winget install Gyan.FFmpeg), then click Re-check.",
                         foreground="#1d6b2f" if ok else "#a33")
        remux_chk.configure(state="normal" if ok else "disabled")
        if ok:
            remux_var.set(True)
    ttk.Button(t_in, text="Re-check ffmpeg", command=recheck_ffmpeg).grid(row=8, column=2, sticky="e")
    ttk.Label(t_in, text="Tip: the first run defaults to 1 episode so you can test. Set 0 for everything.",
              foreground="#555").grid(row=9, column=0, columnspan=3, sticky="w")
    t_in.columnconfigure(0, weight=1)

    # ---- Run tab
    cols = ("file", "status", "t_download", "t_remux", "t_total", "mb", "detail")
    table_frame = ttk.Frame(t_run)
    table_frame.pack(fill="x")
    tree = ttk.Treeview(table_frame, columns=cols, show="headings", height=9)
    for c, w, t in (("file", 380, "File"), ("status", 90, "Status"), ("t_download", 100, "Download s"),
                    ("t_remux", 90, "Remux s"), ("t_total", 90, "Total s"), ("mb", 60, "MB"), ("detail", 320, "Detail / reason")):
        tree.heading(c, text=t)
        tree.column(c, width=w, anchor="w" if c in ("file", "detail") else "center")
    tree.tag_configure("OK", foreground="#1d6b2f")
    tree.tag_configure("FAILED", foreground="#b00020")
    tree.tag_configure("CORRUPT_EXISTING", foreground="#b00020")
    tree.tag_configure("CANCELLED", foreground="#a86a00")
    tree.tag_configure("DOWNLOADED", foreground="#a86a00")
    tree.tag_configure("RUNNING", foreground="#a86a00")
    sy = ttk.Scrollbar(table_frame, orient="vertical", command=tree.yview)
    sx = ttk.Scrollbar(table_frame, orient="horizontal", command=tree.xview)
    tree.configure(yscrollcommand=sy.set, xscrollcommand=sx.set)
    tree.grid(row=0, column=0, sticky="nsew")
    sy.grid(row=0, column=1, sticky="ns")
    sx.grid(row=1, column=0, sticky="ew")
    table_frame.columnconfigure(0, weight=1)
    detail_var = tk.StringVar(value="Select a row to read its full path and reason.")
    ttk.Label(t_run, textvariable=detail_var, wraplength=950, foreground="#333").pack(anchor="w", pady=(6, 0))
    tree.bind("<<TreeviewSelect>>", lambda e: detail_var.set(" | ".join(str(v) for v in tree.item(tree.selection()[0], "values") if v != "")) if tree.selection() else None)
    bar = ttk.Progressbar(t_run, mode="determinate")
    bar.pack(fill="x", pady=(10, 2))
    stage_var = tk.StringVar(value="Idle")
    ttk.Label(t_run, textvariable=stage_var, font=("Segoe UI", 10, "bold")).pack(anchor="w")
    log_frame = ttk.Frame(t_run)
    log_frame.pack(fill="both", expand=True, pady=8)
    logbox = tk.Text(log_frame, height=12, font=("Consolas", 9), bg="#10172a", fg="#d7e3ff", relief="flat", state="disabled", wrap="word")
    log_sb = ttk.Scrollbar(log_frame, orient="vertical", command=logbox.yview)
    logbox.configure(yscrollcommand=log_sb.set)
    logbox.pack(side="left", fill="both", expand=True)
    log_sb.pack(side="right", fill="y")
    btns = ttk.Frame(t_run)
    btns.pack(fill="x")
    start_btn = ttk.Button(btns, text="Start", style="Gold.TButton")
    cancel_btn = ttk.Button(btns, text="Cancel", state="disabled")
    start_btn.pack(side="left")
    cancel_btn.pack(side="left", padx=8)

    # ---- Results tab
    sum_frame = ttk.Frame(t_res)
    sum_frame.pack(fill="both", expand=True)
    summary_box = tk.Text(sum_frame, font=("Consolas", 10), relief="solid", bd=1, wrap="none")
    sum_y = ttk.Scrollbar(sum_frame, orient="vertical", command=summary_box.yview)
    sum_x = ttk.Scrollbar(sum_frame, orient="horizontal", command=summary_box.xview)
    summary_box.configure(yscrollcommand=sum_y.set, xscrollcommand=sum_x.set)
    summary_box.grid(row=0, column=0, sticky="nsew")
    sum_y.grid(row=0, column=1, sticky="ns")
    sum_x.grid(row=1, column=0, sticky="ew")
    sum_frame.rowconfigure(0, weight=1)
    sum_frame.columnconfigure(0, weight=1)
    summary_box.insert("1.0", "The run summary appears here when a run finishes.")
    rb = ttk.Frame(t_res)
    rb.pack(fill="x", pady=(8, 0))
    state = {"out": None, "cancel": threading.Event(), "q": queue.Queue(), "rows": {}}

    def opener(name):
        return lambda: open_path(Path(state["out"]) / name) if name and state["out"] else (open_path(state.get("root_out")) if not name and state.get("root_out") else None)

    for label, name in (("Open output folder", ""), ("Open summary.txt", "summary.txt"), ("Open playlist.csv", "playlist.csv"),
                        ("Open run-log.csv", "run-log.csv"), ("Open workbench.log", "workbench.log")):
        ttk.Button(rb, text=label, command=opener(name)).pack(side="left", padx=(0, 8))

    def append_log(line):
        follow_tail = logbox.yview()[1] >= 0.99
        logbox.configure(state="normal")
        logbox.insert("end", line + "\n")
        lines = int(logbox.index("end-1c").split(".")[0])
        if lines > 2000:
            logbox.delete("1.0", f"{lines - 1999}.0")
        if follow_tail:
            logbox.see("end")
        logbox.configure(state="disabled")

    def set_row(r):
        vals = (r.get("path", r["file"]), r["status"], r["t_download"], r["t_remux"], r["t_total"], f"{r['bytes'] / 1e6:.0f}" if r["bytes"] else "", r.get("detail", ""))
        tag = "OK" if r["status"] in ("OK", "SKIPPED") else r["status"]
        row_key = r.get("key", r["file"])
        if row_key in state["rows"]:
            tree.item(state["rows"][row_key], values=vals, tags=(tag,))
        else:
            state["rows"][row_key] = tree.insert("", "end", values=vals, tags=(tag,))
        tree.see(state["rows"][row_key])

    def poll():
        try:
            for _ in range(100):
                kind, *a = state["q"].get_nowait()
                if kind == "search":
                    if a[0] != search_generation[0]:
                        continue
                    res_list.delete(0, "end")
                    found[:] = [ident for ident, title in a[1]]
                    for ident, title in a[1]:
                        res_list.insert("end", f"{ident} - {title}")
                    if a[2]:
                        messagebox.showerror("Search failed", a[2])
                elif kind == "runpath":
                    state["out"] = a[0]
                elif kind == "log":
                    append_log(a[0])
                elif kind == "total":
                    bar.configure(maximum=max(a[0], 1), value=0)
                elif kind == "progress":
                    bar.configure(value=a[0])
                elif kind == "row":
                    set_row(a[0])
                elif kind == "stage":
                    stage_var.set(f"{a[0]}: {a[1]}")
                elif kind == "dl":
                    pct = f"{a[1] * 100 // a[2]}%" if a[2] else ""
                    stage_var.set(f"{a[0]}: downloading {a[1] / 1e6:,.0f} MB {pct}")
                elif kind == "done":
                    summary_box.delete("1.0", "end")
                    summary_box.insert("1.0", a[0])
                    stage_var.set(a[0].splitlines()[1])
                    start_btn.configure(state="normal")
                    cancel_btn.configure(state="disabled")
                    nb.select(t_res)
        except queue.Empty:
            pass
        root.after(120, poll)

    def start():
        items = [parse_item(x) for x in items_box.get("1.0", "end").splitlines() if x.strip()]
        if not items or not out_var.get().strip():
            messagebox.showwarning("Missing input", "Add at least one item and choose an output folder.")
            return
        try:
            limit, pause = int(limit_var.get()), int(pause_var.get())
            if not 0 <= limit <= 999 or not 0 <= pause <= 120:
                raise ValueError("Use limit 0..999 and pause 0..120")
        except (ValueError, tk.TclError) as error:
            messagebox.showerror("Invalid settings", str(error))
            return
        cfg = {"items": list(dict.fromkeys(items)), "out": out_var.get().strip(), "remux": remux_var.get(),
               "limit": int(limit_var.get()), "pause": int(pause_var.get())}
        try:
            CFG_PATH.write_text(json.dumps({**cfg, "items": "\n".join(cfg["items"])}), encoding="utf-8")
        except OSError as error:
            append_log(f"Note: settings could not be saved ({error}); the run is not affected.")
        state.update(out=cfg["out"], root_out=cfg["out"], cancel=threading.Event(), rows={})
        tree.delete(*tree.get_children())
        stage_var.set("Starting...")
        start_btn.configure(state="disabled")
        cancel_btn.configure(state="normal")
        nb.select(t_run)
        threading.Thread(target=run_job, daemon=True,
                         args=(cfg, lambda *a: state["q"].put(a), state["cancel"])).start()

    start_btn.configure(command=start)
    cancel_btn.configure(command=lambda: (state["cancel"].set(), stage_var.set("Cancelling...")))
    def close_window():
        if str(start_btn.cget("state")) == "disabled":
            if not messagebox.askyesno("Cancel active run?", "Cancel and wait for cleanup before closing?"):
                return
            state["cancel"].set()
            def wait_for_worker():
                if str(start_btn.cget("state")) == "disabled":
                    root.after(250, wait_for_worker)
                else:
                    root.destroy()
            wait_for_worker()
        else:
            root.destroy()
    root.protocol("WM_DELETE_WINDOW", close_window)
    poll()
    return root


def headless(argv):
    """Run without a window. Prints progress, writes the same reports, returns an exit code."""
    import argparse, signal
    ap = argparse.ArgumentParser(prog="AJN_Zip_Workbench_v2.pyw --headless")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--item", action="append", default=[], help="Archive item id or link (repeatable)")
    ap.add_argument("--playlist", action="append", default=[], help=".m3u of zip-member links (repeatable); no Archive listing needed")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=1, help="episodes per item, 0 = all")
    ap.add_argument("--pause", type=int, default=5)
    ap.add_argument("--no-remux", action="store_true", help="download only (files may not seek)")
    a = ap.parse_args(argv)
    if not 0 <= a.limit <= 999 or not 0 <= a.pause <= 120:
        print("Invalid settings: limit must be 0..999 and pause 0..120", file=sys.stderr)
        return 3
    items = list(dict.fromkeys(x for x in (parse_item(i) for i in a.item) if x))
    members = {}
    for pl in a.playlist:
        try:
            for k, v in members_from_playlist(pl).items():
                members.setdefault(k, []).extend(v)
        except (OSError, ValueError) as e:
            print(f"Playlist error: {e}", file=sys.stderr)
            return 3
    items = list(dict.fromkeys(items + list(members)))
    if not items:
        print("Give at least one --item or --playlist", file=sys.stderr)
        return 3
    cfg = {"members": members, "items": items, "out": a.out, "remux": not a.no_remux, "limit": a.limit, "pause": a.pause}
    cancel = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, lambda *_: cancel.set())
        except (ValueError, OSError):
            pass
    box, last_pct = {"summary": ""}, {}

    def emit(kind, *args):
        if kind == "log":
            print(args[0], flush=True)
        elif kind == "stage":
            print(f"  {args[0]}: {args[1]}", flush=True)
        elif kind == "dl":
            name, got, total = args
            pct = (got * 100 // total) // 10 * 10 if total else got // (100 << 20) * 10
            if last_pct.get(name) != pct:
                last_pct[name] = pct
                print(f"  {name}: downloaded {got / 1e6:,.0f} MB" + (f" ({got * 100 // total}%)" if total else ""), flush=True)
        elif kind == "row" and args[0]["status"] != "RUNNING":
            r = args[0]
            print(f"  -> {r['status']} {r['path']} (download {r['t_download']}s, remux {r['t_remux']}s, total {r['t_total']}s)", flush=True)
        elif kind == "done":
            box["summary"] = args[0]

    run_job(cfg, emit, cancel)
    print("\n" + box["summary"], flush=True)
    step = os.environ.get("GITHUB_STEP_SUMMARY")
    if step:
        try:
            with open(step, "a", encoding="utf-8") as f:
                f.write("```text\n" + box["summary"] + "```\n")
        except OSError:
            pass
    lines = box["summary"].splitlines()
    outcome = lines[1] if len(lines) > 1 else "Failed"
    return {"Completed": 0, "Completed with failures": 1, "Cancelled": 2}.get(outcome, 3)


def main():
    if "--headless" in sys.argv[1:]:
        sys.exit(headless(sys.argv[1:]))
    try:
        build_ui().mainloop()
    except Exception:  # noqa: BLE001 - a .pyw has no console, so report the crash visibly
        import traceback
        text = traceback.format_exc()
        crash = Path.home() / "ajn_zip_workbench_crash.log"
        try:
            crash.write_text(text, encoding="utf-8")
        except OSError:
            pass
        try:
            import tkinter as tk
            from tkinter import messagebox
            r = tk.Tk(); r.withdraw()
            messagebox.showerror("AJN Zip Workbench crashed", f"{text[-1500:]}\n\nSaved to: {crash}")
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
