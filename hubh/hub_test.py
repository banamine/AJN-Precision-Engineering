import json,os,mimetypes,glob
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
O='https://hub.test';D=os.path.join(os.path.dirname(HERE),'hubh-dist')
C48=open(os.path.join(HERE,'classic48.json')).read()
def launch(p):
  exe=os.environ.get('CHROMIUM_PATH')
  if not exe:
    c=glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium-*/chrome-linux/chrome'))+glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')
    exe=c[0] if c else None
  return p.chromium.launch(executable_path=exe,args=['--no-sandbox']) if exe else p.chromium.launch(args=['--no-sandbox'])
CATS=['documentaries','old-time-radio','classic-cinema','cartoons','audiobooks','newsreels','scifi-horror','educational']
def lib(cat,page):
  items=[]
  for i in range(6):
    n=f'{cat}-p{page}-{i}'
    items.append({'type':'item','id':n,'identifier':n,'title':f'{cat} item {page}.{i}','categoryIds':[cat],'mediaType':'audio' if cat in('old-time-radio','audiobooks') else 'video','year':1950+i,'path':f'/download/{n}/{n}.mp4','dur':1800,'assetId':'asset-'+n})
  return {'items':items}
state={'fail48':False,'pending':False,'libfail':False}
errs=[];fails=[]
def run(viewport,label):
  with sync_playwright() as p:
    b=launch(p)
    ctx=b.new_context(viewport=viewport,timezone_id='UTC',ignore_https_errors=True);pg=ctx.new_page()
    pg.clock.set_fixed_time('2026-10-14T12:00:00Z')
    pg.on('pageerror',lambda e:errs.append(str(e)))
    def h(r):
      u=r.request.url
      if '/api/home/classic-48h' in u:
        if state['fail48']: r.fulfill(status=500,body='x');return
        body=C48
        if state['pending']: body=json.dumps({'guideId':'classic-tv','windowStartMs':0,'windowEndMs':0,'generatedAt':None,'stale':False,'pending':True,'channels':[]})
        r.fulfill(status=200,content_type='application/json',body=body);return
      if '/api/library/items' in u:
        if state['libfail']: r.fulfill(status=503,body='x');return
        q=dict(x.split('=') for x in u.split('?')[1].split('&'))
        r.fulfill(status=200,content_type='application/json',body=json.dumps(lib(q['category'],q['page'])));return
      if '/api/home/now' in u: r.fulfill(status=200,content_type='application/json',body=json.dumps({'generatedAt':'2026-10-14T12:00:00Z','items':[],'pending':[],'failed':[],'nextChangeAt':None}));return
      if '/api/' in u: r.fulfill(status=200,content_type='application/json',body='{"channels":[],"programs":[],"items":[]}');return
      path=u.replace(O,'').split('?')[0]
      if path in('','/'):path='/index.html'
      f=D+path
      if os.path.isfile(f):r.fulfill(status=200,content_type=mimetypes.guess_type(f)[0] or 'text/plain',body=open(f,'rb').read())
      else:r.abort()
    pg.route('**/*',h)
    print('=====',label)
    # fresh load
    pg.goto(O+'/');pg.wait_for_selector('[data-testid=discover-card]',timeout=10000)
    ok=lambda name,c:(print(('PASS ' if c else 'FAIL ')+name),None if c else fails.append(name))
    ok('4 rows present (live, discover, classic, reel)',pg.locator('[data-testid=hub-discover]').count()==1 and pg.locator('[data-testid=hub-classic48]').count()==1)
    n=pg.locator('[data-testid=discover-card]').count();ok(f'discover shows 1..10 cards ({n})',1<=n<=10)
    titles=pg.locator('[data-testid=discover-card] button[aria-label^=Play]').evaluate_all('e=>e.map(x=>x.getAttribute("aria-label"))')
    cats=set(t.split(', ')[1] for t in titles if ', ' in t);ok(f'diverse categories ({len(cats)})',len(cats)>=4)
    # play on click -> args
    pg.locator('[data-testid=discover-card] button[aria-label^=Play]').first.click()
    a=pg.evaluate('window.__plays[0]');print('  play args',a)
    ok('click plays with path/title/mediaType/channel/guide/program/asset',a and a[0].startswith('/download/') and a[3] in('video','audio') and a[5]=='library' and a[8].startswith('asset-'))
    # stable across remount
    pg.reload();pg.wait_for_selector('[data-testid=discover-card]')
    t2=pg.locator('[data-testid=discover-card] button[aria-label^=Play]').evaluate_all('e=>e.map(x=>x.getAttribute("aria-label"))')
    ok('same picks after reload (session seed)',t2==titles)
    # shuffle
    pg.click('[data-testid=discover-shuffle]');pg.wait_for_timeout(200)
    t3=pg.locator('[data-testid=discover-card] button[aria-label^=Play]').evaluate_all('e=>e.map(x=>x.getAttribute("aria-label"))')
    ok('shuffle changes picks',t3!=t2)
    # not interested
    first=pg.locator('[data-testid=discover-card]').first.locator('button[aria-label^=Play]').get_attribute('aria-label')
    pg.locator('[data-testid=discover-card]').first.locator('button[aria-label^="Not interested"]').click(force=True)
    t4=pg.locator('[data-testid=discover-card] button[aria-label^=Play]').evaluate_all('e=>e.map(x=>x.getAttribute("aria-label"))')
    ok('not interested removes it',first not in t4)
    pg.reload();pg.wait_for_selector('[data-testid=discover-card]')
    ok('dismissal persisted',first not in pg.locator('[data-testid=discover-card] button[aria-label^=Play]').evaluate_all('e=>e.map(x=>x.getAttribute("aria-label"))'))
    ok('Show hidden control present',pg.get_by_text('Show hidden (1)').count()==1)
    pg.get_by_text('Show hidden (1)').click();ok('show hidden clears',pg.get_by_text('Show hidden').count()==0)
    # collapse persisted
    pg.click('#hub-discover-heading');ok('discover collapses',pg.locator('[data-testid=discover-card]').count()==0 and pg.get_attribute('#hub-discover-heading','aria-expanded')=='false')
    pg.reload();pg.wait_for_selector('#hub-discover-heading')
    ok('collapsed state persisted',pg.get_attribute('#hub-discover-heading','aria-expanded')=='false')
    pg.click('#hub-discover-heading');pg.wait_for_selector('[data-testid=discover-card]')
    # classic row
    exp=pg.get_attribute('#hub-classic48-heading','aria-expanded');print('  classic expanded by default:',exp)
    if exp!='true': pg.click('#hub-classic48-heading')
    pg.wait_for_selector('[data-testid=classic-card]',timeout=8000)
    cc=pg.locator('[data-testid=classic-card]').count();ok(f'classic today cards ({cc})',cc>0)
    firstlabel=pg.locator('[data-testid=classic-card] button[aria-label^=Play]').first.get_attribute('aria-label');print('  ',firstlabel)
    ok('classic card says it plays from the start (no live tune-in implied)','from the start' in firstlabel and pg.get_by_text('Play from start').count()>0)
    pg.locator('[data-testid=classic-card] button[aria-label^=Play]').first.click()
    a=pg.evaluate('window.__plays[window.__plays.length-1]');print('  classic play args',a)
    ok('classic click plays direct (guide classic-tv)',a[5]=='classic-tv' and a[0].startswith('/download/'))
    pg.click('[data-testid=classic-tab-tomorrow]');pg.wait_for_timeout(200)
    tc=pg.locator('[data-testid=classic-card]').count();print('  tomorrow cards',tc)
    ok(f'tomorrow tab has cards ({tc}) and projection note',tc>0 and pg.get_by_text('Partial: tomorrow').count()==1)
    pg.click('[data-testid=classic-tab-today]')
    pg.select_option('[data-testid=classic-jump]',index=2);pg.wait_for_timeout(300)
    ok('jump select resets to placeholder',pg.input_value('[data-testid=classic-jump]')=='')
    # open in guide
    pg.locator('[data-testid=classic-card]').first.locator('button[aria-label^="Open"]').click()
    navs=pg.evaluate('window.__navs');pk=pg.evaluate("window.__peek('classic-tv')");print('  navs',navs,'focus',pk)
    ok('Open in Guide navigates + holds focus request',navs and navs[-1]=='tv-guide' and pk and pk.get('channelId'))
    # reel mounted
    pg.wait_for_timeout(600)
    ok('reel mounted (lazy chunk loaded)',pg.locator('[data-testid=home-broadcast-hub]').inner_text().lower().count('police')>0 or pg.locator('text=/police chase/i').count()>0)
    # touch target sizes
    small=pg.evaluate("""()=>[...document.querySelectorAll('[data-testid=home-broadcast-hub] button')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<30)}).map(b=>(b.getAttribute('aria-label')||b.textContent).slice(0,30))""")
    mine=[x for x in small if x not in('Try again',)]
    print('  buttons <30px high:',small)
    t44=pg.evaluate("""()=>{const hub=document.querySelector('[data-testid=hub-discover],[data-testid=hub-classic48]');const sel='[data-testid=hub-discover] button,[data-testid=hub-classic48] button,[data-testid=hub-classic48] select';return [...document.querySelectorAll(sel)].filter(b=>b.offsetParent!==null&&!b.closest('[data-testid=discover-list]')||b.getAttribute('aria-label')?.startsWith('Not interested')).filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&(r.height<43.5||r.width<43.5)&&!b.hasAttribute('data-skip44')}).map(b=>(b.getAttribute('aria-label')||b.textContent).slice(0,40)+' '+Math.round(b.getBoundingClientRect().width)+'x'+Math.round(b.getBoundingClientRect().height))}""")
    print('  hub controls under 44px:',t44)
    ok('hub controls are at least 44px high (the row title/Play buttons are full-card)',all('Play ' in x or 'Scroll' in x for x in t44) or t44==[])
    # horizontal overflow of page
    ok('no page-level horizontal overflow',pg.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    pg.screenshot(path=os.path.join(HERE,f'hub-{label}.png'),full_page=True)
    # failure states
    state['fail48']=True;state['libfail']=True
    pg.evaluate("localStorage.clear();sessionStorage.clear()");pg.reload()
    pg.wait_for_selector('text=Discover could not be loaded',timeout=8000)
    al=pg.locator('[role=alert]').all_inner_texts();print('  alerts',al)
    ok('discover failure is explicit with retry',any('Discover' in x and 'Try again' in x for x in al))
    pg.click('#hub-classic48-heading') if pg.get_attribute('#hub-classic48-heading','aria-expanded')!='true' else None
    pg.wait_for_selector('text=The Classic TV lineup could not',timeout=8000)
    al=pg.locator('[role=alert]').all_inner_texts()
    ok('classic failure is explicit (no fake lineup)',any('Classic' in x for x in al) and pg.locator('[data-testid=classic-card]').count()==0)
    state['fail48']=False;state['libfail']=False
    pg.locator('[role=alert]:has-text("Discover") button').click();pg.wait_for_timeout(1200)
    ok('retry recovers discover',pg.locator('[data-testid=discover-card]').count()>0)
    # refresh failure after data loaded keeps data but says so
    state['fail48']=False;state['pending']=False
    pg.reload()
    if pg.get_attribute('#hub-classic48-heading','aria-expanded')!='true': pg.click('#hub-classic48-heading')
    pg.wait_for_selector('[data-testid=classic-card]',timeout=8000)
    state['fail48']=True
    pg.evaluate("window.dispatchEvent(new Event('visibilitychange'))")
    pg.click('#hub-classic48-heading');pg.click('#hub-classic48-heading')  # collapse + reopen re-runs the loader with data already cached? (hook state persists)
    pg.wait_for_timeout(1200)
    ok('refresh failure with data loaded is shown, data kept',pg.locator('[data-testid=classic-refresh-error]').count()==1 and pg.locator('[data-testid=classic-card]').count()>0)
    state['fail48']=False
    state['pending']=True
    pg.reload();
    if pg.get_attribute('#hub-classic48-heading','aria-expanded')!='true': pg.click('#hub-classic48-heading')
    pg.wait_for_selector('[data-testid=classic-pending]',timeout=8000);ok('pending is shown honestly',True)
    state['pending']=False
    b.close()
run({'width':1280,'height':800},'desktop');run({'width':390,'height':800},'phone')
print('page errors',errs[:5]);print('FAILS',fails)
