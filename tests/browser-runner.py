"""Run a browser scenario on the isolated CDP test browser, never a live account.
Usage: python tests/browser-runner.py suite.js runFunction
Requires Python websockets and Chrome on 127.0.0.1:9227. Server URL is
MOSAIC_BROWSER_URL (defaults to the mock auto-login server on port 8020).
"""
import asyncio, base64, json, os, pathlib, sys, tempfile, urllib.request
import websockets

async def run():
    url = os.environ.get('MOSAIC_BROWSER_URL', 'http://127.0.0.1:8020')
    if not url.startswith(('http://127.0.0.1:', 'http://localhost:')):
        raise RuntimeError('Browser scenarios require an isolated local test server.')
    cdp='http://127.0.0.1:'+os.environ.get('MOSAIC_CDP_PORT','9227')
    target = json.load(urllib.request.urlopen(urllib.request.Request(cdp+'/json/new?about:blank', method='PUT'),timeout=10))
    errors, seq = [], 0
    async with websockets.connect(target['webSocketDebuggerUrl'], max_size=40000000, origin=cdp) as ws:
        async def call(method, params=None):
            nonlocal seq
            seq += 1
            current = seq
            await ws.send(json.dumps({'id': current, 'method': method, 'params': params or {}}))
            while True:
                message = json.loads(await ws.recv())
                if message.get('method') == 'Runtime.exceptionThrown':
                    errors.append(message['params']['exceptionDetails'])
                if message.get('id') == current:
                    if 'error' in message:
                        raise RuntimeError(message['error'])
                    return message.get('result', {})
        await call('Runtime.enable')
        await call('Page.enable')
        await call('Page.bringToFront')
        await call('Network.enable')
        await call('Network.setBlockedURLs', {'urls': ['*fonts.googleapis.com*', '*fonts.gstatic.com*']})
        if os.environ.get('MOSAIC_CLEAR_AUTH') == '1':
            await call('Network.clearBrowserCookies')
        width = int(os.environ.get('MOSAIC_WIDTH', '1440'))
        height = int(os.environ.get('MOSAIC_HEIGHT', '1000'))
        await call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 600})
        await call('Page.navigate', {'url': url})
        for _ in range(200):
            ready = await call('Runtime.evaluate', {'expression': 'Boolean(window.MosaicAccount&&((window.MosaicCore&&window.MosaicCredits)||document.getElementById("adminApp")))', 'returnByValue': True})
            if ready.get('result', {}).get('value'):
                break
            await asyncio.sleep(.05)
        else:
            raise RuntimeError('Editor modules did not initialize: '+json.dumps(errors))
        await call('Runtime.evaluate', {'expression': 'window.MosaicAccount.ready()', 'awaitPromise': True})
        if os.environ.get('MOSAIC_KEEP_KEYS') != '1':
            await call('Runtime.evaluate', {'expression': '(async()=>{if(!window.MosaicAuth)return;await new Promise((resolve,reject)=>{const r=indexedDB.open("mozai-private-keys",1);r.onupgradeneeded=()=>r.result.createObjectStore("credentials",{keyPath:"id"});r.onerror=reject;r.onsuccess=()=>{const db=r.result,tx=db.transaction("credentials","readwrite");tx.objectStore("credentials").clear();tx.oncomplete=()=>{db.close();resolve()};tx.onerror=reject}});window.MosaicAuth.clear()})()', 'awaitPromise': True})
        result = {}
        if len(sys.argv) > 2:
            source = (pathlib.Path('tests') / sys.argv[1]).read_text(encoding='utf-8')
            loaded = await call('Runtime.evaluate', {'expression': source})
            if 'exceptionDetails' in loaded:
                raise RuntimeError(loaded['exceptionDetails'])
            result = await call('Runtime.evaluate', {'expression': sys.argv[2]+'()', 'awaitPromise': True, 'returnByValue': True, 'timeout': 120000})
            if len(sys.argv)>3 and 'exceptionDetails' not in result:
                first=result
                await call('Page.reload', {'ignoreCache': True})
                for _ in range(200):
                    ready=await call('Runtime.evaluate', {'expression': 'Boolean(window.MosaicAuth&&window.MosaicCredits)', 'returnByValue': True})
                    if ready.get('result',{}).get('value'):break
                    await asyncio.sleep(.05)
                await call('Runtime.evaluate', {'expression': source})
                result=await call('Runtime.evaluate', {'expression': sys.argv[3]+'()', 'awaitPromise': True, 'returnByValue': True, 'timeout': 120000})
                print(json.dumps({'beforeReload':first},indent=2))
        screenshot = await call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
        dest = pathlib.Path(tempfile.gettempdir()) / ('mozai-'+(sys.argv[2] if len(sys.argv)>2 else 'landing')+'-'+str(width)+'.png')
        dest.write_bytes(base64.b64decode(screenshot['data']))
        print(json.dumps({'result': result, 'consoleErrors': errors, 'screenshot': str(dest)}, indent=2))
        await call('Page.close')
        if 'exceptionDetails' in result or errors:
            raise RuntimeError('Browser validation failed; see report above.')

asyncio.run(run())
