#!/usr/bin/env python3
"""Trusted host worker. The web container has no Docker or source-code mount."""
import fcntl, json, os, pathlib, re, signal, subprocess, time
ROOT=pathlib.Path('/srv/blog')
PATTERN=re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$')
def status(name,state):
    target=ROOT/'results'/name
    temp=target.with_suffix('.tmp')
    temp.write_text(json.dumps({'state':state}),encoding='utf-8');temp.replace(target)
def tick():
    for item in sorted((ROOT/'queue').iterdir()):
        if not PATTERN.fullmatch(item.name) or item.is_symlink() or not item.is_file():continue
        result=ROOT/'results'/item.name
        if result.exists():continue
        status(item.name,'building')
        if item.stat().st_size>16*1024*1024:status(item.name,'failed');continue
        # Copy untrusted request once; exporter revalidates every field in an isolated container.
        snap=ROOT/'publishing'/item.name
        with item.open('rb') as source,snap.open('xb') as dest:dest.write(source.read(16*1024*1024+1))
        env=os.environ.copy();env['BLOG_CMS_MANIFEST']=str(snap)
        log=ROOT/'builds'/('cms-'+item.stem+'.log')
        try:
            with log.open('w') as out:
                task=subprocess.Popen(['bash',str(ROOT/'project/deploy/blogctl'),'publish'],env=env,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
                try:
                    if task.wait(timeout=1800)!=0:raise subprocess.CalledProcessError(task.returncode,task.args)
                except subprocess.TimeoutExpired:
                    os.killpg(task.pid,signal.SIGTERM)
                    try:task.wait(timeout=15)
                    except subprocess.TimeoutExpired:os.killpg(task.pid,signal.SIGKILL);task.wait()
                    raise
            status(item.name,'succeeded')
        except (subprocess.SubprocessError,OSError):status(item.name,'failed')
        finally:snap.unlink(missing_ok=True)
        break
if __name__=='__main__':
    os.umask(0o077)
    with (ROOT/'.worker.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        # Interrupted jobs are never silently replayed.
        for p in (ROOT/'results').glob('*.json'):
            if json.loads(p.read_text()).get('state')=='building':status(p.name,'failed')
        while True:
            try:tick()
            except Exception as e:print(type(e).__name__,flush=True)
            time.sleep(5)
