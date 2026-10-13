#!/usr/bin/env python3
import http.client, json, os, threading, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN=os.getenv('LISTEN','127.0.0.1:8094')
OLLAMA=os.getenv('OLLAMA_BASE_URL','http://127.0.0.1:11434').rstrip('/')
MODEL=os.getenv('GEMMA_MODEL','gemma4:e2b')
CONTEXT=4096
KEEP_ALIVE=-1
WARM_CHECK_SECONDS=60
ORIGINS={x for x in os.getenv('ALLOWED_ORIGINS','https://nishad.ai').split(',') if x}
MAX_BODY=32768
SEM=threading.BoundedSemaphore(int(os.getenv('MAX_CONCURRENT_REQUESTS','1')))
TIMEOUT=int(os.getenv('UPSTREAM_TIMEOUT_SECONDS','120'))
counts={}; lock=threading.Lock()

def keep_model_warm():
 started=time.monotonic()
 acquired=False
 try:
  with urllib.request.urlopen(OLLAMA+'/api/ps',timeout=5) as r:state=json.load(r)
  if not isinstance(state,dict) or not isinstance(state.get('models'),list):
   raise ValueError('invalid model state')
  target_loaded=False
  for model in state['models']:
   if not isinstance(model,dict):raise ValueError('invalid model state')
   if model.get('name')!=MODEL:continue
   target_loaded=True
   if model.get('context_length')!=CONTEXT:continue
   expires=model.get('expires_at')
   if not isinstance(expires,str):raise ValueError('invalid model expiry')
   expiry=datetime.fromisoformat(expires.replace('Z','+00:00'))
   if expiry.tzinfo is None:raise ValueError('invalid model expiry')
   if expiry>datetime.now(timezone.utc)+timedelta(days=1):return
  if state['models'] and not target_loaded:
   print(json.dumps({'event':'warmup','status':'deferred','reason':'other_model_resident','retry_seconds':WARM_CHECK_SECONDS}),flush=True)
   return
  # Never queue a maintenance load behind a visitor's generation.
  acquired=SEM.acquire(False)
  if not acquired:return
  payload={'model':MODEL,'messages':[],'stream':False,'think':False,'keep_alive':KEEP_ALIVE,'options':{'num_ctx':CONTEXT}}
  req=urllib.request.Request(OLLAMA+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
  with urllib.request.urlopen(req,timeout=TIMEOUT) as r:result=json.load(r)
  if not isinstance(result,dict) or result.get('done') is not True or result.get('done_reason')!='load' or result.get('error'):
   raise ValueError('incomplete model preload')
  print(json.dumps({'event':'warmup','status':'ready','duration_ms':round((time.monotonic()-started)*1000)}),flush=True)
 except (OSError,urllib.error.URLError,http.client.HTTPException,ValueError):
  print(json.dumps({'event':'warmup','status':'unavailable','retry_seconds':WARM_CHECK_SECONDS,'duration_ms':round((time.monotonic()-started)*1000)}),flush=True)
 finally:
  if acquired:SEM.release()

def maintain_warm_model(stop):
 while not stop.is_set():
  keep_model_warm()
  stop.wait(WARM_CHECK_SECONDS)

def allowed_messages(v):
 return isinstance(v,list) and 1<=len(v)<=4 and all(isinstance(x,dict) and x.get('role') in {'system','user'} and isinstance(x.get('content'),str) and len(x['content'])<=20000 for x in v)
def bump(k,n):
 day=time.strftime('%Y-%m-%d',time.gmtime()); key=day+':'+k
 with lock:
  if counts.get(key,0)>=n:return False
  counts[key]=counts.get(key,0)+1; return True
class H(BaseHTTPRequestHandler):
 server_version='nishad-mac-gemma/2'
 def log_message(self,fmt,*args): print(json.dumps({'event':'request','status':args[1] if len(args)>1 else 'unknown'}),flush=True)
 def origin(self):
  x=self.headers.get('Origin',''); return x if x in ORIGINS else None
 def sendj(self,n,obj,origin=None,extra=None):
  b=json.dumps(obj,separators=(',',':')).encode(); self.send_response(n); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(b))); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
  if origin:self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
  if extra:
   for k,v in extra.items():self.send_header(k,v)
  self.end_headers();self.wfile.write(b)
 def sende(self,event):
  self.wfile.write(('data: '+json.dumps(event,separators=(',',':'))+'\n\n').encode())
  self.wfile.flush()
 def do_OPTIONS(self):
  o=self.origin()
  if not o:return self.sendj(403,{'error':'origin_not_allowed'})
  self.send_response(204);self.send_header('Access-Control-Allow-Origin',o);self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type');self.send_header('Access-Control-Max-Age','86400');self.send_header('Vary','Origin');self.end_headers()
 def do_GET(self):
  if self.path!='/healthz':return self.sendj(404,{'error':'not_found'})
  try:
   with urllib.request.urlopen(OLLAMA+'/api/tags',timeout=5) as r:d=json.load(r)
   names={m.get('name') for m in d.get('models',[])}; ok=MODEL in names
  except Exception:ok=False
  self.sendj(200 if ok else 503,{'status':'ok' if ok else 'unavailable','model':MODEL})
 def do_POST(self):
  o=self.origin()
  if not o:return self.sendj(403,{'error':'origin_not_allowed'})
  if self.path!='/':return self.sendj(404,{'error':'not_found'},o)
  try:n=int(self.headers.get('Content-Length','0'))
  except:n=0
  if n<1 or n>MAX_BODY:return self.sendj(413,{'error':'payload_too_large'},o)
  try:d=json.loads(self.rfile.read(n))
  except:return self.sendj(400,{'error':'invalid_json'},o)
  msgs=d.get('messages') if isinstance(d,dict) else None
  if not allowed_messages(msgs):return self.sendj(400,{'error':'invalid_messages'},o)
  client=self.headers.get('CF-Connecting-IP') or self.headers.get('X-Real-IP') or 'unknown'
  if not bump('ip:'+client[:64],40) or not bump('global',1000):return self.sendj(429,{'error':'visitor_limit'},o,{'Retry-After':'3600'})
  if not SEM.acquire(False):return self.sendj(503,{'error':'busy'},o,{'Retry-After':'15'})

  # Terminal chat explicitly sets mode:'chat'. Structured reports omit it.
  # Reports get Ollama JSON mode plus enough output room for the complete schema;
  # chat preserves the lower-latency free-text configuration.
  is_report=isinstance(d,dict) and d.get('mode')!='chat'
  payload={
   'model':MODEL,
   'messages':msgs,
   'stream':True,
   'think':False,
   'keep_alive':KEEP_ALIVE,
   'options':{
    'temperature':0.2 if is_report else 0.7,
    'num_predict':1200 if is_report else 256,
    'num_ctx':CONTEXT
   }
  }
  if is_report:payload['format']='json'

  req=urllib.request.Request(OLLAMA+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
  started=time.monotonic()
  try:
   up=urllib.request.urlopen(req,timeout=TIMEOUT)
  except (OSError,urllib.error.URLError,http.client.HTTPException) as error:
   code='upstream_timeout' if isinstance(error,TimeoutError) or isinstance(getattr(error,'reason',None),TimeoutError) else 'upstream_unreachable'
   print(json.dumps({'event':'generation','mode':'report' if is_report else 'chat','error':code,'duration_ms':round((time.monotonic()-started)*1000)}),flush=True)
   SEM.release();return self.sendj(504 if code=='upstream_timeout' else 502,{'error':code},o)
  failure=None; finish_reason=None; prompt_tokens=None; output_tokens=None
  try:
   with up:
    self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store, no-transform');self.send_header('X-Accel-Buffering','no');self.send_header('Access-Control-Allow-Origin',o);self.send_header('Vary','Origin');self.end_headers()
    try:
     for raw in up:
      try:e=json.loads(raw)
      except (json.JSONDecodeError,UnicodeDecodeError):
       failure='upstream_invalid_response';break
      if not isinstance(e,dict):
       failure='upstream_invalid_response';break
      if e.get('error'):
       failure='upstream_failed';break
      message=e.get('message') or {}
      if not isinstance(message,dict) or not isinstance(message.get('content',''),str):
       failure='upstream_invalid_response';break
      delta=message.get('content','')
      if delta:self.sende({'delta':delta,'finish_reason':None})
      if e.get('done') is True:
       reason=e.get('done_reason')
       if not isinstance(reason,str) or not reason:
        failure='upstream_incomplete';break
       finish_reason=reason
       prompt_tokens=e.get('prompt_eval_count') if isinstance(e.get('prompt_eval_count'),int) else None
       output_tokens=e.get('eval_count') if isinstance(e.get('eval_count'),int) else None
       self.sende({'done':True,'finish_reason':finish_reason});break
     else:failure='upstream_incomplete'
    except (BrokenPipeError,ConnectionResetError):raise
    except TimeoutError:failure='upstream_timeout'
    except (OSError,http.client.HTTPException):failure='upstream_incomplete'
    if failure:self.sende({'error':failure})
  except (BrokenPipeError,ConnectionResetError):failure='request_cancelled'
  finally:
   print(json.dumps({'event':'generation','mode':'report' if is_report else 'chat','duration_ms':round((time.monotonic()-started)*1000),'input_bytes':n,'finish_reason':finish_reason,'error':failure,'prompt_tokens':prompt_tokens,'output_tokens':output_tokens}),flush=True)
   SEM.release()
def main():
 h,p=LISTEN.rsplit(':',1);server=ThreadingHTTPServer((h,int(p)),H)
 stop=threading.Event()
 threading.Thread(target=maintain_warm_model,args=(stop,),daemon=True).start()
 try:server.serve_forever()
 finally:
  stop.set();server.server_close()
if __name__=='__main__':main()
