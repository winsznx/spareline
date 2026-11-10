const pptxgen = require('./deck_node/node_modules/pptxgenjs');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const SUM = JSON.parse(fs.readFileSync(path.join(ROOT,'evaluations/summary.json'),'utf8'));
const MET = SUM.metrics;
const HOLD = JSON.parse(fs.readFileSync(path.join(ROOT,'data/processed/travel_model.json'),'utf8')).holdout.all_pairs;
const IN = JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/deck_inputs.json'),'utf8'));
const SHOT = (n)=>path.join(ROOT,'artifacts/screens',n);
const n0 = (v)=>Number(v).toLocaleString('en-US');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Timothy Popoola, Anu Kolapo';
pptx.subject = 'DataNova 2026 Global Data-thon: Spareline working product';
pptx.title = 'Spareline | Rescue late deliveries';
pptx.company = 'Spareline';
pptx.lang = 'en-US';
pptx.theme = { headFontFace: 'Inter', bodyFontFace: 'Inter', lang:'en-US' };
const SW=13.333, SH=7.5;
const C={white:'FFFFFF',canvas:'FFFFFF',surface:'F7F8FA',ink:'171C22',graphite:'131920',slate:'26313D',muted:'58636E',faint:'77818B',border:'E2E6EA',copper:'A76941',copperDark:'8A4F2C',copperLight:'F5EBE5',blue:'426886',blueLight:'EAF0F4',success:'187451',successLight:'EAF5EF',warning:'B66D22',warningLight:'FBF1E5',danger:'B53C3C',darkBg:'0D1217',darkSurface:'151C23',darkBorder:'2A343F',darkText:'F1F4F6',darkMuted:'A7B2BD'};
const ST=pptx.ShapeType;
function rect(s,x,y,w,h,fill=C.white,line=null,r=.0){s.addShape(r?ST.roundRect:ST.rect,{x,y,w,h,rectRadius:r,fill:{color:fill},line:line?{color:line,width:.7}:{color:fill,transparency:100}})}
function line(s,x1,y1,x2,y2,color=C.border,width=1,opts={}){s.addShape(ST.line,{x:x1,y:y1,w:x2-x1,h:y2-y1,line:{color,width,...opts}})}
function txt(s,t,x,y,w,h,opts={}){s.addText(t,{x,y,w,h,margin:0,fontFace:'Inter',fontSize:14,color:C.ink,breakLine:false,valign:'mid',...opts})}
function pill(s,text,x,y,w,fill=C.surface,color=C.muted,h=.32){rect(s,x,y,w,h,fill,null,.16);txt(s,text,x+.10,y+.017,w-.20,h-.034,{fontSize:8.7,bold:true,color,align:'center',charSpacing:.35})}
function circle(s,cx,cy,r,fill,border=null){s.addShape(ST.ellipse,{x:cx-r,y:cy-r,w:r*2,h:r*2,fill:{color:fill},line:{color:border||fill,width:border?1:0}})}
function title(s,eyebrow,heading,subtitle=null){txt(s,eyebrow.toUpperCase(),.68,.45,11,.27,{fontSize:9.7,bold:true,charSpacing:1.8,color:C.copperDark});txt(s,heading,.68,.90,12.0,.62,{fontSize:28.5,bold:true,color:C.ink,breakLine:false});if(subtitle)txt(s,subtitle,.68,1.62,11.9,.55,{fontSize:12.3,color:C.muted,valign:'top',breakLine:false})}
function footer(s,no,tag='',dark=false){const y=7.13;line(s,.68,y,12.67,y,dark?C.darkBorder:C.border,.8);txt(s,'SPARELINE   /   DATANOVA 2026',.70,7.19,5,.18,{fontSize:8.1,bold:true,charSpacing:.75,color:dark?C.darkMuted:C.faint});txt(s,tag,6.15,7.19,5.8,.18,{fontSize:8.1,color:dark?C.darkMuted:C.faint,align:'right'});txt(s,String(no).padStart(2,'0'),12.20,7.19,.48,.18,{fontSize:8.3,color:dark?C.darkMuted:C.faint,align:'right',bold:true})}
function add(s,tag='',dark=false){s.background={color:dark?C.graphite:C.white};footer(s,pptx._slides.length,tag,dark);return s}
function addLogo(s,x,y,size=.46,dark=false){
  // Portable, editable shape rendition of the original converging routes mark.
  rect(s,x,y,size,size,C.graphite,null,.10);
  const scale=size/.46;
  const q=(v)=>v*scale;
  line(s,x+q(.08),y+q(.14),x+q(.18),y+q(.14),'F4F5F6',3.7);
  line(s,x+q(.18),y+q(.14),x+q(.28),y+q(.255),'F4F5F6',3.7);
  line(s,x+q(.28),y+q(.255),x+q(.39),y+q(.255),'F4F5F6',3.7);
  line(s,x+q(.08),y+q(.34),x+q(.18),y+q(.34),'8DABBB',3.7);
  line(s,x+q(.18),y+q(.34),x+q(.28),y+q(.21),'8DABBB',3.7);
  line(s,x+q(.28),y+q(.21),x+q(.39),y+q(.21),'8DABBB',3.7);
  circle(s,x+q(.28),y+q(.23),q(.036),C.copper);
}
function card(s,x,y,w,h,{fill=C.white,border=C.border,r=.13}={}){s.addShape(ST.roundRect,{x,y,w,h,rectRadius:r,fill:{color:fill},line:{color:border,width:.8}})}
function textBlock(s,head,body,x,y,w,{headerSize=16.5,bodySize=11.8,headColor=C.ink,bodyColor=C.muted}={}){txt(s,head,x,y,w,.55,{fontSize:headerSize,bold:true,color:headColor,valign:'top'});txt(s,body,x,y+.59,w,1.0,{fontSize:bodySize,color:bodyColor,valign:'top',breakLine:false})}
function nLabel(s,num,x,y,fill=C.copper){circle(s,x+.17,y+.17,.17,fill);txt(s,String(num).padStart(2,'0'),x,y+.03,.34,.24,{fontSize:9,color:C.white,bold:true,align:'center'})}
function source(s,text,link=null,y=6.87){txt(s,text,.70,y,11.90,.18,{fontSize:8.1,color:C.faint,hyperlink:link?{url:link}:undefined})}
function miniNode(s,x,y,color=C.ink,r=.075){circle(s,x,y,r,C.white,color)}

// 01 — COVER
{
 const s=pptx.addSlide(); s.background={color:C.graphite};
 rect(s,8.65,0,4.7,7.09,C.darkSurface);
 addLogo(s,.72,.58,.52,true);
 txt(s,'SPARELINE',1.39,.62,4.8,.45,{fontSize:19.8,bold:true,charSpacing:1.25,color:C.darkText});
 pill(s,'DATANOVA 2026  /  DN-OR-01',.75,1.78,3.08,C.slate,C.darkText,.39);
 txt(s,'When a delivery route\nfalls behind, know\nexactly what to move.',.76,2.37,7.55,2.24,{fontSize:36.6,bold:true,color:C.white,breakLine:false,valign:'top',lineSpacingMultiple:1.04});
 txt(s,'A dispatch decision tool for late-route recovery.',.76,5.17,6.9,.55,{fontSize:17.1,color:C.darkMuted});
 txt(s,IN.team_names,.76,5.78,7.0,.40,{fontSize:14.2,bold:true,color:C.darkText});
 txt(s,'WORKING PRODUCT  •  '+IN.url.replace('https://','').toUpperCase(),.78,6.43,7.1,.30,{fontSize:10.2,bold:true,charSpacing:1.22,color:'C89A75',hyperlink:{url:IN.url}});
 // abstract route network—not a fake UI
 const x=8.90,y=1.18;
 txt(s,'A rescue must work for both routes.',x,y,3.80,.45,{fontSize:15.3,bold:true,color:C.darkText});
 line(s,9.10,2.32,10.08,2.32,'F1F4F6',4.7);line(s,10.08,2.32,10.72,3.12,'F1F4F6',4.7);line(s,10.72,3.12,11.62,3.12,'F1F4F6',4.7);
 line(s,9.10,4.88,10.08,4.88,'829BAA',4.7);line(s,10.08,4.88,10.72,3.55,'829BAA',4.7);line(s,10.72,3.55,11.62,3.55,'829BAA',4.7);
 circle(s,10.72,3.34,.27,C.copper);circle(s,10.72,3.34,.09,C.white);
 for(let i=0;i<3;i++){miniNode(s,9.18+i*.42,2.32,C.white,.06);miniNode(s,9.18+i*.42,4.88,'829BAA',.06)}
 txt(s,'DELAYED ROUTE',9.07,1.88,2.80,.23,{fontSize:10.1,bold:true,charSpacing:1,color:C.darkMuted});
 txt(s,'HELPER ROUTE',9.08,5.21,2.80,.24,{fontSize:10.1,bold:true,charSpacing:1,color:C.darkMuted});
 txt(s,'SYNCHRONIZED\nHANDOFF',10.20,3.83,2.45,.61,{fontSize:10.2,color:'D0A17E',bold:true,align:'center'});
 add(s,'HISTORICAL ROUTES  •  SIMULATED DISRUPTIONS',true);
}
// 02 — PROBLEM
{
 const s=pptx.addSlide();title(s,'01 / Problem','The hard decision starts after the plan fails.','One van is running late. Another driver could help, but the wrong rescue spreads the delay to a second route.');
 const cards=[['01','A route slips','Unexpected delay changes the remaining arrival times.'],['02','Someone offers to help','A second van has its own parcels, limits and commitments.'],['03','The dispatcher decides','Which packages move, where do drivers meet, and who becomes late?']];
 cards.forEach((a,i)=>{let x=.70+i*4.23;card(s,x,2.44,3.97,2.42,{fill:C.surface,border:C.border});pill(s,a[0],x+.24,2.70,.58,C.graphite,C.white,.33);txt(s,a[1],x+.25,3.20,3.50,.44,{fontSize:18.4,bold:true});txt(s,a[2],x+.25,3.79,3.45,.83,{fontSize:12.0,color:C.muted,valign:'top'})});
 rect(s,.70,5.35,11.92,.91,C.graphite);txt(s,'The question:',1.00,5.56,1.40,.31,{fontSize:12.2,color:'C7B4A4',bold:true});txt(s,'Can a rescue save the late route without breaking the helping route?',2.45,5.49,9.60,.46,{fontSize:17.3,color:C.white,bold:true});
 source(s,'Problem anchor: public accounts from delivery drivers sent on rescues, and delivery-operations research. Not customer interviews.',null,6.76);add(s,'PROBLEM & USER');
}
// 03 — TWO ROUTES
{
 const s=pptx.addSlide();title(s,'02 / Why it is difficult','Rescue is a two-route decision.','Moving a parcel only helps if two vehicles can meet and still finish feasible schedules.');
 card(s,.69,2.30,7.28,3.76,{fill:C.surface,border:C.border});
 txt(s,'DONOR VEHICLE',.98,2.58,2.35,.25,{fontSize:10.8,bold:true,color:C.ink,charSpacing:.9});
 txt(s,'HELPER VEHICLE',.99,5.63,2.35,.25,{fontSize:10.8,bold:true,color:C.blue,charSpacing:.9});
 const aY=3.38,bY=5.08;line(s,1.24,aY,3.48,aY,C.graphite,4.4);line(s,3.48,aY,4.39,4.20,C.graphite,4.4);line(s,4.39,4.20,7.36,4.20,C.graphite,4.4);
 line(s,1.24,bY,3.48,bY,C.blue,4.4);line(s,3.48,bY,4.39,4.48,C.blue,4.4);line(s,4.39,4.48,7.36,4.48,C.blue,4.4);
 [1.38,2.42,3.36].forEach(z=>miniNode(s,z,aY,C.graphite,.075));[1.38,2.42,3.36].forEach(z=>miniNode(s,z,bY,C.blue,.075));
 circle(s,4.39,4.34,.23,C.copper);circle(s,4.39,4.34,.07,C.white);pill(s,'MEETING POINT',4.87,3.62,1.73,C.copperLight,C.copperDark,.32);
 let arr=[['01','Capacity','Can the helper actually carry the transferred load?'],['02','Timing','Can both vans arrive at the same place?'],['03','Windows','Do customers still get parcels inside their delivery window?'],['04','Side effects','Does the helper now miss its own deliveries?']];
 arr.forEach((a,i)=>{const y=2.27+i*.94; nLabel(s,a[0],8.44,y+.10,i===3?C.blue:C.copper);txt(s,a[1],8.95,y,3.40,.31,{fontSize:14.5,bold:true});txt(s,a[2],8.95,y+.37,3.35,.43,{fontSize:10.9,color:C.muted})});
 source(s,'Diagram is illustrative. In the product, meeting time, handoff duration and both revised routes are calculated by the solver.',null,6.75);add(s,'RESCUE CONSTRAINTS');
}
// 04 — SOLUTION
{
 const s=pptx.addSlide();title(s,'03 / Solution','One rescue recommendation. All consequences visible.','Spareline turns a route disruption into an actionable, checkable handoff plan.');
 let cols=[{n:'01',head:'Identify risk',body:'Replay each van to now, apply the delay, and find the stops that will miss a window or the end of the shift.',chip:'INPUT'},{n:'02',head:'Evaluate transfers',body:'Try each helper van, meeting point and group of stops. Check van space and both new routes.',chip:'OPTIMIZE'},{n:'03',head:'Issue instructions',body:'Compare with doing nothing and with the nearest van, then export both drivers’ new stop lists.',chip:'OUTPUT'}];
 cols.forEach((a,i)=>{let x=.70+4.19*i;card(s,x,2.35,3.90,3.69,{fill:i===1?C.graphite:C.surface,border:i===1?C.graphite:C.border});pill(s,a.chip,x+.24,2.61,1.15,i===1?'32424C':C.white,i===1?'E5DFD9':C.muted);txt(s,a.n,x+.25,3.24,1.16,.50,{fontSize:25.0,bold:true,color:i===1?'BE8F6D':C.copper});txt(s,a.head,x+.25,3.88,3.4,.44,{fontSize:19.3,bold:true,color:i===1?C.white:C.ink});txt(s,a.body,x+.25,4.50,3.33,1.12,{fontSize:12.1,color:i===1?C.darkMuted:C.muted,valign:'top'});if(i<2)txt(s,'→',x+3.95,4.04,.28,.44,{fontSize:25,bold:true,color:C.copper,align:'center'})});
 rect(s,.70,6.28,11.88,.45,C.copperLight);txt(s,'It can also return “no safe rescue” or “low confidence”: it withheld a transfer in '+(MET.abstention.low_confidence+MET.abstention.no_safe_rescue_with_missed_packages)+' of '+MET.abstention.denominator_scenarios_with_missed_packages+' at-risk evaluation scenarios.',.88,6.36,11.4,.27,{fontSize:11.6,bold:true,color:C.copperDark});add(s,'PRODUCT MECHANISM');
}
// 05 — PRODUCT CAPTURE
{
 const s=pptx.addSlide();title(s,'04 / Product experience','Designed for the dispatcher’s next action.','An operations desk, not a chatbot. The live optimization result drives every status and instruction.');
 pill(s,'REAL CAPTURE  •  '+IN.url.replace('https://','')+'  •  SCENARIO A',.72,2.10,5.18,C.copperLight,C.copperDark,.32);
 const ih=4.30, iw=ih/IN.desk_shot_ratio;
 card(s,.70,2.58,iw+.12,ih+.12,{fill:C.white,border:'CFD7DD',r:.06});
 s.addImage({path:SHOT('desk-recommended-1440.png'),altText:'Spareline recovery desk in production: scenario A with map, decision and policy comparison',x:.76,y:2.64,w:iw,h:ih});
 const bx=.70+iw+.45;
 const notes=[['Map and decision from one run','Donor solid, helper dashed, meeting point and moved stops marked; stop table as fallback.'],['Three policies side by side','Doing nothing, nearest van and Spareline, with run ID and data source.'],['Labelled provenance','Historical, reconstructed, simulated, estimated and model results are tagged.']];
 notes.forEach((a,i)=>{const yy=2.62+i*1.18;nLabel(s,a[0]?String(i+1):'',bx,yy+.02);txt(s,a[0],bx+.48,yy,12.62-bx-.48,.30,{fontSize:12.6,bold:true,valign:'top'});txt(s,a[1],bx+.48,yy+.36,12.62-bx-.48,.72,{fontSize:10.4,color:C.muted,valign:'top'})});
 add(s,'RECOVERY DESK');
}
// 05b — WALKTHROUGH
{
 const s=pptx.addSlide();const A=IN.scenarios.a;
 title(s,'05 / Live walkthrough','Inside one recommended rescue.','Scenario A in production: what the dispatcher approves and what the helper driver receives.');
 const iw=7.30, ih=iw*0.625;
 card(s,.70,2.36,iw+.12,ih+.12,{fill:C.white,border:'CFD7DD',r:.06});
 s.addImage({path:SHOT('handoff-1440.png'),altText:'Handoff and manifests page: meeting point, timing, validation checks and package groups to move',x:.76,y:2.42,w:iw,h:ih});
 const mw=1.95, mh=mw*(2532/1170)*0.62;
 card(s,8.30,2.36,mw+.12,4.42,{fill:C.white,border:'CFD7DD',r:.06});
 s.addImage({path:SHOT('driver-mobile-390.png'),altText:'Helper driver’s revised stop list on a phone',x:8.36,y:2.42,w:mw,h:4.30,sizing:{type:'crop',w:mw,h:4.30}});
 const bx=10.55;
 const notes=[['Meet at stop XC','Van A arrives first and waits; the handoff takes 21.5 min for 66 parcels.'],[''+A.moved+' stops move','Missed packages: '+A.na+' → '+A.sp+'. The helper gains no missed package.'],['Two-step sign-off','Dispatcher approves, then both drivers confirm. Only then is anything marked transferred.']];
 notes.forEach((a,i)=>{const yy=2.40+i*1.45;txt(s,a[0],bx,yy,2.1,.30,{fontSize:12.4,bold:true,valign:'top'});txt(s,a[1],bx,yy+.36,2.1,1.0,{fontSize:10.0,color:C.muted,valign:'top'})});
 add(s,'HANDOFF & DRIVER MANIFEST');
}
// 06 — DATA
{
 const s=pptx.addSlide();title(s,'06 / Data foundation','Real historical routes. Explicitly simulated disruptions.','The source data is not a recording of vehicle failures, live GPS or actual rescue operations.');
 card(s,.70,2.22,4.62,3.85,{fill:C.graphite,border:C.graphite});txt(s,n0(IN.bundle.routes),1.02,2.50,3.7,.90,{fontSize:48,bold:true,color:C.white});txt(s,'historical routes used, in '+IN.bundle.groups+' groups',1.05,3.48,3.95,.40,{fontSize:15.2,color:C.white,bold:true});txt(s,n0(IN.bundle.stops)+' stop records  ·  '+n0(IN.bundle.packages)+' packages',1.05,3.88,3.9,.30,{fontSize:11.6,color:C.darkMuted});line(s,1.03,4.33,4.95,4.33,'485561',1);txt(s,'Amazon / MIT Last Mile Routing Research\nChallenge, evaluation split (9,184 routes\npublished in total)',1.04,4.50,4.0,.86,{fontSize:11.4,color:C.darkMuted,valign:'top'});pill(s,'2018  ·  RESEARCH DATA',1.05,5.48,2.57,'32424C',C.darkText,.35);
 card(s,5.59,2.22,7.03,3.85,{fill:C.surface,border:C.border});
 const steps=[['Observed in the dataset','Stops, packages, time windows, capacity, recorded sequence and within-route travel times. Only 7.1% of packages carry a window; service time repeats per package, so a stop takes the max.'],['Constructed for evaluation','Same-depot, same-day groups of 2–4 routes; van progress reconstructed from each route’s own matrix; between-route travel estimated (held-out MAE '+Math.round(HOLD.mae_s)+' s, q10–q90 coverage '+(HOLD.interval_coverage*100).toFixed(1)+'%).'],['Simulated on purpose','Delays, area slowdowns and van failures, labelled wherever shown. 60-min shift limit and handoff time are declared assumptions.']];
 steps.forEach((a,i)=>{const yy=2.42+i*1.18;circle(s,5.97,yy+.17,.11,i===0?C.success:(i===1?C.blue:C.copper));txt(s,a[0],6.22,yy,6.06,.32,{fontSize:14.1,bold:true});txt(s,a[1],6.22,yy+.36,6.15,.74,{fontSize:10.3,color:C.muted,valign:'top'})});
 source(s,'Source: registry.opendata.aws/amazon-last-mile-challenges/ (evaluation split, downloaded '+IN.acquired+') • CC BY-NC 4.0; research use, not unrestricted commercial reuse.','https://registry.opendata.aws/amazon-last-mile-challenges/',6.78);add(s,'DATA & PROVENANCE');
}
// 07 — TECHNICAL
{
 const s=pptx.addSlide();title(s,'07 / Technical approach','A feasible plan is better than a confident guess.','A real optimization engine determines what can move, when vehicles can meet and what happens afterwards.');
 let blocks=[['01','RECONSTRUCT','Replay to cutoff\n+ simulated shock'],['02','GENERATE','Helpers × meeting\npoints × stop groups'],['03','SOLVE','OR-Tools re-sequence\n+ synchronized handoff'],['04','VERIFY','Invariant checker\n+ q90 travel re-check'],['05','DECIDE','Recommend, no safe\nrescue, low confidence']];
 blocks.forEach((a,i)=>{let x=.72+i*2.51;card(s,x,2.49,2.23,2.08,{fill:i===2?C.graphite:C.surface,border:i===2?C.graphite:C.border});pill(s,a[0],x+.18,2.72,.48,i===2?'32424C':C.white,i===2?C.white:C.muted,.29);txt(s,a[1],x+.18,3.26,1.92,.31,{fontSize:12.5,bold:true,color:i===2?C.white:C.ink});txt(s,a[2],x+.18,3.76,1.95,.60,{fontSize:10.5,color:i===2?C.darkMuted:C.muted,valign:'top'});if(i<4)txt(s,'→',x+2.28,3.26,.24,.42,{fontSize:19.8,bold:true,color:C.copper})});
 rect(s,.71,4.86,11.88,1.32,C.copperLight);txt(s,'Optimization core',.99,5.05,2.2,.31,{fontSize:15.2,bold:true,color:C.copperDark,valign:'top'});
 txt(s,'Both vans must reach the same stop location; the handoff starts when the later one arrives and lasts 5 min + 15 s per parcel. OR-Tools re-sequences the helper with soft window and shift penalties while a rank dimension keeps its own stops in observed order. An independent checker verifies conservation, capacity, synchronized arrival and forward time, then every cross-route leg is re-timed at its q90 estimate.',3.12,4.98,9.25,1.12,{fontSize:10.6,color:C.ink,valign:'top'});
 txt(s,'Objective: fewest missed packages on all vans → no new helper misses → fewest late minutes → least added driving and waiting.',.82,6.38,11.90,.26,{fontSize:10.6,bold:true,color:C.muted,align:'center'});add(s,'OPTIMIZATION ENGINE');
}
// 07b — BUILT AND TESTED
{
 const s=pptx.addSlide();
 title(s,'08 / Engineering','Built, deployed and tested end to end.','What runs behind the demo, and how we know it works.');
 const lanes=[['Browser','Next.js app on Vercel, deployed with the CLI. Map, decision, manifests, results.'],['API','FastAPI on our VPS in its own Docker project. Solver runs in worker processes; repeat requests reuse the same run.'],['Solver','Python + Google OR-Tools. Independent invariant checker on every plan.'],['Data','Postgres with versioned migrations: routes, stops, packages, travel matrices, runs, approvals, evaluation rows.']];
 lanes.forEach((a,i)=>{const yy=2.32+i*.86;card(s,.70,yy,6.40,.74,{fill:i===2?C.graphite:C.surface,border:i===2?C.graphite:C.border,r:.10});txt(s,a[0],.95,yy+.10,1.2,.54,{fontSize:12.4,bold:true,color:i===2?C.white:C.ink});txt(s,a[1],2.15,yy+.08,4.8,.58,{fontSize:10.0,color:i===2?C.darkMuted:C.muted})});
 const tests=[[String(IN.tests.backend),'backend tests pass: data parsing, time zones, solver invariants, baselines, API flow, bad input'],[String(IN.tests.e2e_production),'browser tests pass on the live site at 1440, 1024, 768 and 390 px'],['0','invariant violations in '+SUM.scenario_count+' evaluated plans'],['409','returned for a second approval, a stale revision or an export before approval']];
 tests.forEach((a,i)=>{const yy=2.32+i*.86;txt(s,a[0],7.55,yy+.04,1.1,.60,{fontSize:24,bold:true,color:C.copper});txt(s,a[1],8.70,yy+.08,3.95,.62,{fontSize:10.6,color:C.ink})});
 source(s,'Approval state is kept per browser session, so judges never see each other’s changes. Rate limits, input validation and CORS are on.',null,6.62);
 add(s,'ARCHITECTURE & QUALITY');
}
// 08 — EVALUATION
{
 const s=pptx.addSlide();title(s,'09 / Evaluation method','Same scenario. Three policies. Both vehicles scored.','The test is built to find where the rescue fails, not to produce a nice win rate.');
 let arr=[['01','Do nothing','Every van keeps its remaining observed order under the same disruption.'],['02','Nearest feasible helper','Closest van takes every at-risk stop at the late van’s position by cheapest insertion; must fit capacity and shift.'],['03','Spareline','Optimize helper, meeting point, moved stops and order together; abstain when unsafe or uncertain.']];
 arr.forEach((a,i)=>{let x=.72+i*4.20;card(s,x,2.36,3.93,2.22,{fill:i===2?C.graphite:C.surface,border:i===2?C.graphite:C.border});pill(s,a[0],x+.25,2.60,.47,i===2?'394957':C.white,i===2?C.white:C.muted);txt(s,a[1],x+.26,3.06,3.43,.48,{fontSize:17.0,bold:true,color:i===2?C.white:C.ink});txt(s,a[2],x+.26,3.62,3.42,.86,{fontSize:10.8,color:i===2?C.darkMuted:C.muted,valign:'top'})});
 const items=[SUM.scenario_count+' predeclared scenarios, 114 held-out groups, 17 depots','4 shocks per group: 75 / 105 min delay, 1.6× slowdown, van failure; seed 2026','Measured: missed (late window or past shift), on-time windowed, helper harm','Also: added drive and wait minutes, solver latency, abstentions, invariant errors'];
 items.forEach((a,i)=>{let col=i%2,row=Math.floor(i/2);circle(s,1.10+col*6.00,4.98+row*.50,.07,C.copper);txt(s,a,1.30+col*6.00,4.80+row*.50,5.55,.35,{fontSize:11.0,color:C.ink,bold:true})});
 source(s,'Config fixed before the run (evaluations/config.json); 46 development groups used only for tuning and demo scenarios. Identical records, shocks, travel model and scoring for all policies; denominators and misses published.',null,6.62);add(s,'EXPERIMENTAL DESIGN');
}
// 09 — JUDGE SCENARIOS
{
 const s=pptx.addSlide();title(s,'10 / Judge experience','Three scenarios. Three meaningful decisions.','Verified on the deployed application '+IN.verified_at+'. Each card is a live solver run; IDs shown for reproduction.');
 const A=IN.scenarios.a, B=IN.scenarios.b, Cc=IN.scenarios.c;
 let arr=[['A','A rescue can help',A.where,'Recommended. Missed packages: '+A.na+' doing nothing, '+A.nf+' nearest van, '+A.sp+' Spareline. '+A.moved+' stops move; helper gains 0 misses.',A],['B','A rescue can hurt',B.where,'No safe rescue. Every transfer that helps the late van makes the helper late (HELPER_WOULD_BE_LATE).',B],['C','No safe rescue exists',Cc.where,'Low confidence. A transfer helps on mean travel but not with cross-route legs at q90; nothing is recommended.',Cc]];
 arr.forEach((a,i)=>{let yy=2.30+i*1.36;card(s,.73,yy,11.87,1.18,{fill:i===1?C.copperLight:C.surface,border:i===1?'E4CBB8':C.border});circle(s,1.25,yy+.59,.27,i===0?C.success:(i===1?C.warning:C.graphite));txt(s,a[0],1.04,yy+.40,.42,.34,{fontSize:15.0,bold:true,color:C.white,align:'center'});txt(s,a[1],1.83,yy+.12,3.75,.37,{fontSize:16.0,bold:true});txt(s,a[2],1.84,yy+.50,4.40,.26,{fontSize:10.2,color:C.muted});txt(s,'scenario '+a[4].scenario_id.slice(0,8)+'  ·  run '+a[4].run_id.slice(0,8),1.84,yy+.80,4.4,.22,{fontSize:8.6,color:C.faint});txt(s,a[3],6.42,yy+.12,5.95,.94,{fontSize:11.2,color:C.ink,bold:true})});
 txt(s,'Demo scenarios come from development groups and are not part of the aggregate results. Plans are advisory until a dispatcher approves and both drivers confirm.',.82,6.47,11.9,.40,{fontSize:9.6,color:C.muted,align:'center'});add(s,'VERIFIED IN PRODUCTION');
}
// 10 — RESULTS
{
 const s=pptx.addSlide();const mp=MET.missed_packages,wo=MET.windowed_on_time,hh=MET.helper_harm,da=MET.delta_vs_no_action,dn=MET.delta_vs_nearest,lat=MET.latency_ms,ab=MET.abstention;
 title(s,'11 / Results','What happened, including the misses.','Replay estimates under simulated disruptions · '+SUM.scenario_count+' scenarios on 114 held-out groups · '+SUM.evaluation_id+'.');
 const x=.72,y=2.30,w=11.88;card(s,x,y,w,3.30,{fill:C.white,border:C.border});rect(s,x,y,w,.50,C.graphite);
 const cols=[{x:1.00,w:4.20,t:'MEASURE'},{x:5.25,w:1.55,t:'DO NOTHING'},{x:6.90,w:1.65,t:'NEAREST VAN'},{x:8.60,w:1.55,t:'SPARELINE'},{x:10.20,w:2.25,t:'DENOMINATOR'}];cols.forEach(c=>txt(s,c.t,c.x,y+.12,c.w,.26,{fontSize:9.4,color:C.white,bold:true,charSpacing:.8}));
 let rows=[['Missed packages, all vans',n0(mp.no_intervention),n0(mp.nearest_feasible),n0(mp.spareline),n0(mp.denominator_remaining_packages)+' remaining'],['Same, cross-route legs at q90','',n0(mp.nearest_feasible_conservative_travel),n0(mp.spareline_conservative_travel),'same cohort'],['On-time windowed packages',n0(wo.no_intervention),n0(wo.nearest_feasible),n0(wo.spareline),n0(wo.denominator_windowed)+' windowed'],['Helper packages newly missed (q90)','',hh.nearest_feasible_newly_missed_helper_packages+' ('+hh.nearest_feasible_newly_missed_helper_packages_conservative+')',hh.spareline_newly_missed_helper_packages+' (0)','donor + helper scored'],['Better / tied / worse vs doing nothing','','',da.spareline_better+' / '+da.tie+' / '+da.spareline_worse,SUM.scenario_count+' scenarios'],['Better / tied / worse vs nearest van','','',dn.spareline_better+' / '+dn.tie+' / '+dn.spareline_worse,SUM.scenario_count+' scenarios']];
 rows.forEach((a,i)=>{let yy=y+.50+i*.465;if(i%2===1)rect(s,x+.01,yy,w-.02,.465,C.surface);line(s,x,yy+.465,x+w,yy+.465,C.border,.5);a.forEach((v,j)=>txt(s,v,cols[j].x,yy+.10,cols[j].w,.27,{fontSize:j===0?10.9:10.6,color:j===3?C.copperDark:(j===4?C.muted:C.ink),bold:j===3}))});
 const k=[[n0(da.packages_saved_total),'missed packages avoided vs doing nothing; mean '+da.mean_per_scenario+'/scenario, 95% CI '+da.ci95_mean_bootstrap[0]+'–'+da.ci95_mean_bootstrap[1]],[String(MET.cost_of_recommended_rescues.count),'rescues recommended; '+(ab.denominator_scenarios_with_missed_packages-MET.cost_of_recommended_rescues.count)+' of '+ab.denominator_scenarios_with_missed_packages+' at-risk scenarios abstained ('+ab.low_confidence+' low confidence)'],[(lat.p95/1000).toFixed(2)+' s','p95 solver time (mean '+(lat.mean/1000).toFixed(2)+' s); 0 invariant violations, 0 errors']];
 k.forEach((a,i)=>{let xx=.74+i*4.0;txt(s,a[0],xx,5.74,1.30,.40,{fontSize:18.5,bold:true,color:C.ink});txt(s,a[1],xx+1.30,5.70,2.55,.52,{fontSize:8.9,color:C.muted,valign:'top'})});
 source(s,'Misses: the nearest van beat Spareline in '+dn.spareline_worse+' scenarios; in 2 it stayed ahead at q90, where the strict helper rule or calibrated-range rule withheld a transfer. Most misses come from the 60-min shift-limit assumption. Not field performance.',null,6.55);
 add(s,'MEASURED, WITH DENOMINATORS');
}
// 11 — FEASIBILITY
{
 const s=pptx.addSlide();title(s,'12 / Adoption path','Built for a narrow, practical dispatch decision.','A research prototype can be useful before it is proven ready for live fleet operations.');
 let a=[['Today: controlled research','Deployed replay of historical routes with clearly marked artificial disruptions, checkable outputs and published misses.'],['Next: operator pilot','With consent, compare recommendations against actual multi-vehicle telemetry and dispatcher outcomes.'],['Then: operational rollout','Add licensed fleet data, verified cross-route travel, human-confirmed transfers and monitored decision quality.']];
 a.forEach((r,i)=>{let yy=2.25+i*1.26;rect(s,.78,yy,.055,1.06,i===0?C.copper:(i===1?C.blue:C.graphite));txt(s,r[0],1.09,yy+.07,4.02,.38,{fontSize:16.8,bold:true});txt(s,r[1],5.02,yy+.03,7.10,.75,{fontSize:12.2,color:C.muted,valign:'top'})});
 rect(s,.76,6.32,11.84,.43,C.surface);txt(s,'Known limits: obfuscated coordinates • no observed cross-route transfers • reconstructed, not GPS, progress • simulated shocks • assumed shift limit • no field validation • noncommercial licence',.96,6.42,11.36,.22,{fontSize:9.6,color:C.muted});add(s,'FEASIBILITY & LIMITATIONS');
}
// 12 — DEMO/CREDITS
{
 const s=pptx.addSlide();s.background={color:C.graphite};
 addLogo(s,.72,.60,.54,true);txt(s,'SPARELINE',1.39,.65,4.72,.43,{fontSize:19.5,bold:true,charSpacing:1.15,color:C.white});
 txt(s,'Try the rescue decision.',.77,1.61,11.8,.81,{fontSize:35.5,bold:true,color:C.white});
 txt(s,'The live demo runs the complete route-recovery loop: scenario, solver, decision, approval and manifests.',.77,2.48,10.9,.61,{fontSize:15.4,color:C.darkMuted});
 let actions=[['01','Open Scenarios and run A, B or C'],['02','Change the disruption and recalculate'],['03','Approve, confirm both drivers, export']];
 actions.forEach((a,i)=>{let x=.78+i*4.14;card(s,x,3.50,3.82,.84,{fill:C.darkSurface,border:C.darkBorder});pill(s,a[0],x+.18,3.75,.49,C.slate,C.white,.30);txt(s,a[1],x+.82,3.72,2.86,.38,{fontSize:11.4,bold:true,color:C.white})});
 card(s,.79,4.81,10.30,1.00,{fill:'233039',border:'354650'});txt(s,'Working demo URL',1.05,5.00,2.36,.25,{fontSize:10.2,color:C.darkMuted,bold:true});txt(s,IN.url,3.38,4.98,7.5,.29,{fontSize:17.0,color:C.white,bold:true,hyperlink:{url:IN.url}});txt(s,'Methodology: '+IN.url.replace('https://','')+'/app/methodology   ·   Results: /app/results',3.38,5.38,7.5,.24,{fontSize:9.6,color:C.darkMuted,hyperlink:{url:IN.url+'/app/methodology'}});
 s.addImage({path:path.join(ROOT,'artifacts/screens/qr.png'),altText:'QR code linking to spareline-steel.vercel.app',x:11.36,y:4.81,w:1.24,h:1.24});
 txt(s,IN.team,.79,6.07,9.4,.26,{fontSize:10.1,color:C.darkMuted});
 txt(s,'Research: Amazon/MIT Last Mile Routing Research Challenge (CC BY-NC 4.0), Merchán et al., Transportation Science 2022  •  Google OR-Tools',.79,6.43,10.4,.30,{fontSize:9.2,color:C.darkMuted});
 add(s,'LIVE LINKS',true);
}

pptx.writeFile({ fileName: path.join(ROOT,'artifacts/Spareline_DataNova_2026_Final.pptx') }).then(f=>console.log(f));
