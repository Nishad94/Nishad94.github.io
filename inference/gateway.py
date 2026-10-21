#!/usr/bin/env python3
import hmac, http.client, ipaddress, json, os, re, select, socket, sys, threading, time, urllib.request, urllib.error
from collections import deque
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
# Windows embeddable Python omits the script directory from its isolated path.
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from telemetry import Telemetry

LISTEN=os.getenv('LISTEN','127.0.0.1:8094')
OLLAMA=os.getenv('OLLAMA_BASE_URL','http://127.0.0.1:11434').rstrip('/')
MODEL=os.getenv('GEMMA_MODEL','gemma4:e2b')
BACKEND=os.getenv('INFERENCE_BACKEND','ollama')
LLAMA=os.getenv('LLAMA_BASE_URL','http://127.0.0.1:8081').rstrip('/')
TOKEN=os.getenv('GATEWAY_TOKEN','')
if BACKEND not in {'ollama','llama.cpp'}:raise ValueError('Unsupported INFERENCE_BACKEND')
CONTEXT=4096
ROUTING_SLOT=0
ANSWER_SLOT=1
KEEP_ALIVE=-1
WARM_CHECK_SECONDS=60
ORIGINS={x for x in os.getenv('ALLOWED_ORIGINS','https://nishad.ai').split(',') if x}
MAX_BODY=32768
MAX_QUEUE_LENGTH=10
QUEUE_WAIT_SECONDS=60

class AdmissionQueue:
 def __init__(self,capacity=1):
  self.capacity=capacity
  self.active=0
  self.slots=threading.BoundedSemaphore(capacity)
  self.condition=threading.Condition()
  self.waiting=deque()
 def acquire(self,blocking=False):
  if blocking:raise ValueError('Use reserve/wait for queued admission')
  with self.condition:
   acquired=not self.waiting and self.slots.acquire(False)
   if acquired:self.active+=1
   return acquired
 def release(self):
  with self.condition:
   self.slots.release()
   self.active-=1
   self.condition.notify_all()
 def reserve(self):
  with self.condition:
   if not self.waiting and self.slots.acquire(False):
    self.active+=1
    return None
   if len(self.waiting)>=MAX_QUEUE_LENGTH:raise OverflowError('queue_full')
   ticket=object()
   self.waiting.append(ticket)
   return ticket
 def discard(self,ticket):
  with self.condition:
   if ticket in self.waiting:self.waiting.remove(ticket)
   self.condition.notify_all()
 def wait(self,ticket,cancelled,heartbeat):
  deadline=time.monotonic()+QUEUE_WAIT_SECONDS
  try:
   while True:
    if cancelled():return 'request_cancelled'
    if time.monotonic()>=deadline:return 'queue_timeout'
    with self.condition:
     if self.waiting and self.waiting[0] is ticket and self.slots.acquire(False):
      self.active+=1
      self.waiting.popleft()
      self.condition.notify_all()
      return None
     self.condition.wait(0.1)
    heartbeat()
  finally:self.discard(ticket)
 def snapshot(self):
  with self.condition:
   return {'active':self.active,'waiting':len(self.waiting),'capacity':MAX_QUEUE_LENGTH,'wait_limit_seconds':QUEUE_WAIT_SECONDS}

SEM=AdmissionQueue(int(os.getenv('MAX_CONCURRENT_REQUESTS','1')))
TIMEOUT=int(os.getenv('UPSTREAM_TIMEOUT_SECONDS','120'))
counts={}; lock=threading.Lock()
METRICS=Telemetry()

def sample_metrics(stop):
 while not stop.is_set():
  try:METRICS.sample_host()
  except (OSError,ValueError):
   print(json.dumps({'event':'host_metrics','error':'sample_unavailable'}),flush=True)
  stop.wait(15)

def probe_model():
 started=time.monotonic()
 try:
  url=LLAMA+'/health' if BACKEND=='llama.cpp' else OLLAMA+'/api/tags'
  with urllib.request.urlopen(url,timeout=5) as r:d=json.load(r)
  ok=d.get('status')=='ok' if BACKEND=='llama.cpp' else MODEL in {m.get('name') for m in d.get('models',[])}
 except (OSError,urllib.error.URLError,http.client.HTTPException,ValueError,AttributeError,TypeError):return False,None
 return ok,round((time.monotonic()-started)*1000,1)

def keep_model_warm():
 if BACKEND!='ollama':return
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
 return isinstance(v,list) and 1<=len(v)<=10 and all(isinstance(x,dict) and x.get('role') in {'system','user','assistant'} and isinstance(x.get('content'),str) and len(x['content'])<=20000 for x in v)
def bump(k,n):
 day=time.strftime('%Y-%m-%d',time.gmtime()); key=day+':'+k
 with lock:
  if counts.get(key,0)>=n:return False
  counts[key]=counts.get(key,0)+1; return True

def routing_schema(ids,limit=3):
 return {
  'type':'object','additionalProperties':False,
  'properties':{
   'needs_site_data':{'type':'boolean'},
   'source_ids':{'type':'array','maxItems':limit,'items':{'type':'string','enum':ids}},
   'intent':{'type':'string','enum':['answer','career_scenarios']},
   'web_search':{'type':'boolean'},
   'web_query':{'type':'string','maxLength':300}
  },
  'required':['needs_site_data','source_ids','intent','web_search','web_query']
 }

def web_intent_schema():
 return {
  'type':'object','additionalProperties':False,
  'properties':{
   'web_search':{'type':'boolean'},
   'web_query':{'type':'string','maxLength':300}
  },
  'required':['web_search','web_query']
 }

def generation_request(messages,is_report,is_route=False,route_ids=None,route_limit=3,is_web_intent=False):
 if is_route and route_ids and 'career' in route_ids:
  messages=[dict(message) for message in messages]
  messages[0]['content']+=(
   '\nEmployer-specific questions about responsibilities, projects, or what Nishad built at a company '
   'must select "career". A verb such as "build" must not select an article merely because its title '
   'starts with "Building".'
  )
 if BACKEND=='llama.cpp':
  payload={
   'id_slot':ROUTING_SLOT if is_route else ANSWER_SLOT,
   'messages':messages,'stream':True,
   'stream_options':{'include_usage':True},
   'temperature':0 if is_route else 0.2 if is_report else 0.7,
   'max_tokens':192 if is_route else 1200 if is_report else 256,
   'chat_template_kwargs':{'enable_thinking':False}
  }
  if is_route:
   schema=web_intent_schema() if is_web_intent else routing_schema(route_ids,route_limit)
   payload['response_format']={'type':'json_schema','json_schema':{'name':'web_intent' if is_web_intent else 'site_routing','strict':True,'schema':schema}}
  elif is_report:payload['response_format']={'type':'json_object'}
  url=LLAMA+'/v1/chat/completions'
 else:
  payload={
   'model':MODEL,'messages':messages,'stream':True,'think':False,'keep_alive':KEEP_ALIVE,
   'options':{'temperature':0 if is_route else 0.2 if is_report else 0.7,'num_predict':192 if is_route else 1200 if is_report else 256,'num_ctx':CONTEXT}
  }
  if is_route:payload['format']=web_intent_schema() if is_web_intent else routing_schema(route_ids,route_limit)
  elif is_report:payload['format']='json'
  url=OLLAMA+'/api/chat'
 return urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')

def upstream_events(up):
 if BACKEND=='ollama':
  for raw in up:yield json.loads(raw)
  return
 frame=[]
 pending=None
 usage={}
 def parse(lines):
  data='\n'.join(line[5:].lstrip() for line in lines if line.startswith('data:'))
  if not data:return None
  if data=='[DONE]':return {'done':True}
  e=json.loads(data)
  if not isinstance(e,dict):raise ValueError('Invalid upstream event')
  if e.get('error'):return {'error':'upstream_failed'}
  choices=e.get('choices')
  if choices==[] and isinstance(e.get('usage'),dict):
   measured=e['usage'];timings=e.get('timings') or {}
   return {'usage':{
    'prompt_eval_count':measured.get('prompt_tokens'),'eval_count':measured.get('completion_tokens'),
    'tokens_per_second':timings.get('predicted_per_second')
   }}
  if not isinstance(choices,list) or len(choices)!=1 or not isinstance(choices[0],dict):
   raise ValueError('Invalid upstream choices')
  choice=choices[0];delta=choice.get('delta')
  if not isinstance(delta,dict):raise ValueError('Invalid upstream delta')
  content=delta.get('content')
  if content is not None and not isinstance(content,str):raise ValueError('Invalid upstream content')
  reason=choice.get('finish_reason')
  if reason is not None and reason not in {'stop','length'}:raise ValueError('Invalid upstream completion')
  return {'message':{'content':content or ''},'done':reason is not None,'done_reason':reason}
 def normalize(event):
  nonlocal pending,usage
  if event is None:return []
  if 'usage' in event:
   usage=event['usage'];return []
  if event.get('done_reason'):
   pending=event
   delta=event.get('message',{}).get('content','')
   pending={**event,'message':{'content':''}}
   return [{'message':{'content':delta},'done':False}] if delta else []
  if event.get('done') is True:
   result={**pending,**usage} if pending else event
   pending=None
   return [result]
  return [event]
 size=0
 for raw in up:
  size+=len(raw)
  if size>262144:raise ValueError('Upstream event too large')
  line=raw.decode('utf-8').rstrip('\r\n')
  if line:frame.append(line)
  else:
   event=parse(frame);frame=[];size=0
   yield from normalize(event)
 if frame:
  event=parse(frame)
  yield from normalize(event)
 if pending:yield {**pending,**usage}

class GatewayServer(ThreadingHTTPServer):
 # Accept bursts so the application can return 429 rather than TCP refusal.
 request_queue_size=64

class H(BaseHTTPRequestHandler):
 server_version='nishad-inference/3'
 def log_message(self,fmt,*args): print(json.dumps({'event':'request','status':args[1] if len(args)>1 else 'unknown'}),flush=True)
 def origin(self):
  x=self.headers.get('Origin',''); return x if x in ORIGINS else None
 def authorized(self):
  return not TOKEN or hmac.compare_digest(self.headers.get('Authorization','').encode(), ('Bearer '+TOKEN).encode())
 def sendj(self,n,obj,origin=None,extra=None):
  b=json.dumps(obj,separators=(',',':')).encode(); self.send_response(n); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(b))); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
  if origin:self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
  if extra:
   for k,v in extra.items():self.send_header(k,v)
  self.end_headers();self.wfile.write(b)
 def sende(self,event):
  self.wfile.write(('data: '+json.dumps(event,separators=(',',':'))+'\n\n').encode())
  self.wfile.flush()
 def start_stream(self,origin):
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store, no-transform');self.send_header('X-Accel-Buffering','no');self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin');self.end_headers()
 def disconnected(self):
  try:
   readable,_,_=select.select([self.connection],[],[],0)
   return bool(readable) and self.connection.recv(1,socket.MSG_PEEK)==b''
  except OSError:return True
 def do_OPTIONS(self):
  o=self.origin()
  if not o:return self.sendj(403,{'error':'origin_not_allowed'})
  self.send_response(204);self.send_header('Access-Control-Allow-Origin',o);self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type');self.send_header('Access-Control-Max-Age','86400');self.send_header('Vary','Origin');self.end_headers()
 def do_GET(self):
  if self.path not in {'/healthz','/metrics'}:return self.sendj(404,{'error':'not_found'})
  if not self.authorized():return self.sendj(401,{'error':'unauthorized'})
  ok,latency=probe_model()
  if self.path=='/metrics':return self.sendj(200,METRICS.snapshot(SEM.snapshot(),ok,latency))
  self.sendj(200 if ok else 503,{'status':'ok' if ok else 'unavailable'})
 def do_POST(self):
  o=self.origin()
  if not o:return self.sendj(403,{'error':'origin_not_allowed'})
  if self.path!='/':return self.sendj(404,{'error':'not_found'},o)
  try:n=int(self.headers.get('Content-Length','0'))
  except:n=0
  if n<1 or n>MAX_BODY:return self.sendj(413,{'error':'payload_too_large'},o)
  raw=self.rfile.read(n)
  if not self.authorized():return self.sendj(401,{'error':'unauthorized'},o)
  try:d=json.loads(raw)
  except:return self.sendj(400,{'error':'invalid_json'},o)
  msgs=d.get('messages') if isinstance(d,dict) else None
  if not allowed_messages(msgs):return self.sendj(400,{'error':'invalid_messages'},o)
  if d.get('task') is not None and not (d.get('task') in {'knowledge_route','web_intent'} and d.get('mode')=='chat'):
   return self.sendj(400,{'error':'invalid_task'},o)
  if d.get('task')=='knowledge_route':
   ids=d.get('route_ids')
   if not isinstance(ids,list) or not 1<=len(ids)<=64 or any(not isinstance(value,str) or not re.fullmatch(r'[a-z0-9/-]{1,80}',value) for value in ids) or len(set(ids))!=len(ids):
    return self.sendj(400,{'error':'invalid_route_ids'},o)
   if d.get('route_limit',3) not in (1,3):return self.sendj(400,{'error':'invalid_route_limit'},o)
  requested_at=time.monotonic()
  METRICS.count('requests')
  client=self.headers.get('CF-Connecting-IP') or self.headers.get('X-Real-IP') or 'unknown'
  if not bump('ip:'+client[:64],40) or not bump('global',1000):
   METRICS.count('rate_limited')
   return self.sendj(429,{'error':'visitor_limit'},o,{'Retry-After':'3600'})
  try:ticket=SEM.reserve()
  except OverflowError:
   METRICS.count('queue_full')
   return self.sendj(429,{'error':'queue_full'},o,{'Retry-After':'15'})
  streaming=ticket is not None
  if streaming:
   METRICS.count('queued')
   try:
    self.start_stream(o)
    self.sende({'queued':True})
    last_heartbeat=time.monotonic()
    def heartbeat():
     nonlocal last_heartbeat
     if time.monotonic()-last_heartbeat>=1:
      self.wfile.write(b': queued\n\n');self.wfile.flush()
      last_heartbeat=time.monotonic()
    result=SEM.wait(ticket,self.disconnected,heartbeat)
    if result:
     METRICS.count('cancelled' if result=='request_cancelled' else 'queue_timeout')
     print(json.dumps({'event':'queue','error':result}),flush=True)
     if result!='request_cancelled':self.sende({'error':result})
     return
   except (BrokenPipeError,ConnectionResetError,OSError):
    METRICS.count('cancelled')
    SEM.discard(ticket)
    print(json.dumps({'event':'queue','error':'request_cancelled'}),flush=True)
    return

  # Terminal chat explicitly sets mode:'chat'. Structured reports omit it.
  # Reports get Ollama JSON mode plus enough output room for the complete schema;
  # chat preserves the lower-latency free-text configuration.
  is_report=isinstance(d,dict) and d.get('mode')!='chat'
  is_route=d.get('task') in {'knowledge_route','web_intent'}
  req=generation_request(msgs,is_report,is_route,d.get('route_ids'),d.get('route_limit',3),d.get('task')=='web_intent')
  started=time.monotonic()
  queue_ms=round((started-requested_at)*1000,1)
  try:
   up=urllib.request.urlopen(req,timeout=TIMEOUT)
  except (OSError,urllib.error.URLError,http.client.HTTPException) as error:
   code='upstream_timeout' if isinstance(error,TimeoutError) or isinstance(getattr(error,'reason',None),TimeoutError) else 'upstream_unreachable'
   print(json.dumps({'event':'generation','mode':'report' if is_report else 'chat','error':code,'duration_ms':round((time.monotonic()-started)*1000)}),flush=True)
   METRICS.generation(round((time.monotonic()-started)*1000,1),queue_ms,None,code,None,None,None,None)
   SEM.release()
   if streaming:return self.sende({'error':code})
   return self.sendj(504 if code=='upstream_timeout' else 502,{'error':code},o)
  failure=None; finish_reason=None; prompt_tokens=None; output_tokens=None; first_token_ms=None; tokens_per_second=None
  try:
   with up:
    if not streaming:self.start_stream(o)
    try:
     for e in upstream_events(up):
      if not isinstance(e,dict):
       failure='upstream_invalid_response';break
      if e.get('error'):
       failure='upstream_failed';break
      message=e.get('message') or {}
      if not isinstance(message,dict) or not isinstance(message.get('content',''),str):
       failure='upstream_invalid_response';break
      delta=message.get('content','')
      if delta:
       if first_token_ms is None:first_token_ms=round((time.monotonic()-requested_at)*1000,1)
       self.sende({'delta':delta,'finish_reason':None})
      if e.get('done') is True:
       reason=e.get('done_reason')
       if not isinstance(reason,str) or not reason:
        failure='upstream_incomplete';break
       finish_reason=reason
       prompt_tokens=e.get('prompt_eval_count') if isinstance(e.get('prompt_eval_count'),int) else None
       output_tokens=e.get('eval_count') if isinstance(e.get('eval_count'),int) else None
       tokens_per_second=e.get('tokens_per_second') if isinstance(e.get('tokens_per_second'),(int,float)) else None
       self.sende({'done':True,'finish_reason':finish_reason});break
     else:failure='upstream_incomplete'
    except (BrokenPipeError,ConnectionResetError):raise
    except (ValueError,UnicodeDecodeError):failure='upstream_invalid_response'
    except TimeoutError:failure='upstream_timeout'
    except (OSError,http.client.HTTPException):failure='upstream_incomplete'
    if failure:self.sende({'error':failure})
  except (BrokenPipeError,ConnectionResetError):failure='request_cancelled'
  finally:
   METRICS.generation(round((time.monotonic()-started)*1000,1),queue_ms,first_token_ms,failure,finish_reason,prompt_tokens,output_tokens,tokens_per_second)
   print(json.dumps({'event':'generation','mode':'report' if is_report else 'chat','duration_ms':round((time.monotonic()-started)*1000),'input_bytes':n,'finish_reason':finish_reason,'error':failure,'prompt_tokens':prompt_tokens,'output_tokens':output_tokens}),flush=True)
   SEM.release()
def main():
 h,p=LISTEN.rsplit(':',1)
 if not ipaddress.ip_address(h).is_loopback:raise ValueError('Gateway must listen on loopback')
 server=GatewayServer((h,int(p)),H)
 stop=threading.Event()
 threading.Thread(target=sample_metrics,args=(stop,),daemon=True).start()
 if BACKEND=='ollama':threading.Thread(target=maintain_warm_model,args=(stop,),daemon=True).start()
 try:server.serve_forever()
 finally:
  stop.set();server.server_close()
if __name__=='__main__':main()
