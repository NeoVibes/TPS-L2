// Read-only document diagnostics. CSP is installed in the HTML before assets.
// This records document resource loads, not traffic from other browser tabs.
const resources=[],violations=[],errors=[];
let observerAvailable=false,resourceBufferOverflow=false;
performance.setResourceTimingBufferSize(100000);
performance.addEventListener('resourcetimingbufferfull',()=>{resourceBufferOverflow=true;});
try{const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())resources.push({url:e.name,initiator:e.initiatorType,startMs:e.startTime,durationMs:e.duration,transferBytes:e.transferSize,responseStatus:e.responseStatus??null});});observer.observe({type:'resource',buffered:true});observerAvailable=true;}catch(error){errors.push({kind:'diagnostics',message:String(error)});}
window.addEventListener('securitypolicyviolation',e=>violations.push({blockedURI:e.blockedURI,directive:e.effectiveDirective,disposition:e.disposition}));
window.addEventListener('error',e=>errors.push({kind:'error',message:e.message||'Required resource failed',source:e.filename||e.target?.src||null,line:e.lineno||null}),true);
window.addEventListener('unhandledrejection',e=>errors.push({kind:'unhandledrejection',message:String(e.reason)}));
export function sessionDiagnostics(){return {scope:'Current document; CSP blocks external runtime resources. User-followed source links and other tabs are outside this scope.',contentSecurityPolicy:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content||null,observerAvailable,resourceBufferOverflow,resources:resources.map(x=>({...x})),violations:violations.map(x=>({...x})),errors:errors.map(x=>({...x}))};}
