// The core concern: reads and writes the Data folder's file formats, and holds the pure logic the UI and the helper share.
// It touches no app state, no DOM and no disk, and uses nothing outside this file but JavaScript's own built-ins.
// tools/discern.mjs and the parser tests load this file by itself and pick out its top-level names, so they stay
// globals, unwrapped, and other concerns may call them bare. It also creates the one global namespace, D.
'use strict';
var VERSION='0.4.1.7'; // the app's version; tools/discern.mjs reads it from here
var FORMAT='0.4.0.2'; // the Format version this app reads and writes: the newest folder in migrations/, next while one is unlanded, or 0.1.0.0 while there are none
// An Item's field values as the files write them, and the words the page shows for them
var URG={today:'Today','this week':'This week',soon:'Soon',later:'Later',fyi:'FYI'};
var URG_ORDER=['today','this week','soon','later','fyi'];
var TYPES=['task','meeting','process','document','fyi'];
var TYPE_NAME={task:'Task',meeting:'Meeting',process:'Process',document:'Document',fyi:'FYI'};
var TYPE_LABEL={task:'Tasks',meeting:'Meetings',process:'Processes & SOPs',document:'Documents to read',fyi:'FYI'};
// no status is to do
var STATUS=['','in progress','waiting'];
var STATUS_LABEL={'':'To do','in progress':'In progress',waiting:'Waiting'};
var PRIORITIES=['high','medium','low'];
var PRIORITY_LABEL={high:'High',medium:'Medium',low:'Low'};
// high first; none counts as medium
function prioRank(v){var n=PRIORITIES.indexOf(v);return n<0?1:n;}
var ITEM_RE=/^- \[( |x)\] (T-\d+) (.*)$/;
function parseMeta(s){var m={};s.split(';').forEach(function(p){var i=p.indexOf(':');if(i>0)m[p.slice(0,i).trim()]=p.slice(i+1).trim();else if(p.trim())(m[' bare']=m[' bare']||[]).push(p.trim());});return m;}
// one physical line: line separators typed or pasted into a field must never split an item
function ol(s){return String(s).replace(/[\r\n\u2028\u2029\u0085]+/g,' ');}
// every kind of line break written as one newline
function nl(s){return String(s==null?'':s).replace(/\r\n?|[\u2028\u2029\u0085]/g,'\n');}
// braces are written {key: value; key: value}; a meta key the order doesn't name is kept, after the others
function metaParts(meta,order){var parts=[];order.forEach(function(k){if(meta[k]!==undefined&&meta[k]!=='')parts.push(k+': '+ol(meta[k]).replace(/;/g,','));});
  Object.keys(meta).forEach(function(k){if(order.indexOf(k)<0&&k.charAt(0)!==' '&&meta[k]!=='')parts.push(k+': '+ol(meta[k]).replace(/;/g,','));});
  (meta[' bare']||[]).forEach(function(b){parts.push(ol(b).replace(/;/g,','));});return parts;}
// INBOX.md holds new Items, then the change Proposals under CHANGES_HEAD. parse keeps those lines, from the heading on, in post.
var CHANGES_HEAD='## Changes';
function parse(text){
  var lines=String(text||'').replace(/\r/g,'').split('\n');var pre=[],items=[],cur=null,post=null;
  if(lines.length&&lines[lines.length-1]==='')lines.pop();
  lines.forEach(textLines(function(ln){
    if(post){post.push(ln);return;}
    if(ln===CHANGES_HEAD){post=[ln];var t=cur?cur.subs:null;
      if(t)while(t.length&&t[t.length-1].k==='raw'&&!t[t.length-1].v.trim())t.pop();
      else while(pre.length&&!pre[pre.length-1].trim())pre.pop();
      return;}
    var m=ITEM_RE.exec(ln);
    if(m){var rest=m[3],meta={},bi=rest.lastIndexOf(' {');
      if(bi>-1&&rest.charAt(rest.length-1)==='}'){meta=parseMeta(rest.slice(bi+2,-1));rest=rest.slice(0,bi);}
      cur={id:m[2],done:m[1]==='x',title:rest,meta:meta,subs:[]};items.push(cur);return;}
    if(!cur){pre.push(ln);return;}
    var s=/^  - (origin|description|link|source-key|comment): ?(.*)$/.exec(ln);
    if(s){cur.subs.push(textSub(s[1],s[2]));return;}
    var c=/^  - \[( |x)\] (.*)$/.exec(ln);
    if(c){cur.subs.push({k:'sub',v:c[2],x:c[1]==='x'});return;}
    cur.subs.push({k:'raw',v:ln});
  },function(){return post?null:cur;},function(){cur.subs.push({k:'raw',v:''});}));
  return {pre:pre,items:items,post:post||[]};}
// A Description or a Comment carries on over the lines below it indented 4 spaces, a blank line in it being an indented
// empty one; a Comment's own line holds only its fields: "  - comment: {added-datetime: YYYY-MM-DD HH:MM; author: user}".
// A Person's history line is laid out the same way: "  - history: {changed-date: YYYY-MM-DD; changed: title}", then "old → new".
// -> {k:'description', v} or {k:'comment'|'history', f:{fields}, v}, v holding the text with \n between its lines
function fielded(k){return k==='comment'||k==='history';}
function textSub(k,rest){
  if(fielded(k)){var t=String(rest).trim(),f={};if(t.charAt(0)==='{'&&t.charAt(t.length-1)==='}'){f=fieldsOf(t.slice(1,-1));t='';}return {k:k,f:f,v:t,n:t?1:0};}
  return {k:k,v:rest,n:rest?1:0};}
// wraps a parser's line handler so the lines that carry on a Description or Comment join its text. A truly empty line
// between them counts as a blank one; any other empty line goes back to the parser through blank once the text is over.
function textLines(each,curOf,blank){var tx=null,gap=0;
  function end(){if(blank)for(;gap;gap--)blank();gap=0;tx=null;}
  return function(ln,i,all){
    if(tx){var c=/^ {4}(.*)$/.exec(ln);
      if(c){for(;gap;gap--){tx.v+='\n';tx.n++;}tx.v=(tx.n?tx.v+'\n':'')+c[1];tx.n++;return;}
      if(ln===''&&i<all.length-1){gap++;return;}
      end();}
    each(ln);
    var cur=curOf(),last=cur&&cur.subs[cur.subs.length-1];
    tx=last&&(last.k==='description'||fielded(last.k))&&last.n!==undefined?last:null;
    if(i===all.length-1)end();};}
var COMMENT_ORDER=['added-datetime','author','acknowledged','changed','from','to','suggests','sender'],HISTORY_ORDER=['changed-date','changed'];
// one sub-line of an Item or Record as written: several physical lines for a Description, Comment or history line
function serSub(b){
  if(b.k==='raw')return b.v;
  if(b.k==='sub')return '  - ['+(b.x?'x':' ')+'] '+ol(b.v);
  if(b.k!=='description'&&!fielded(b.k))return '  - '+b.k+': '+ol(b.v);
  var ls=nl(b.v).split('\n'),f=b.f||{},parts=[],order=b.k==='comment'?COMMENT_ORDER:HISTORY_ORDER;
  var head='  - '+b.k+':';
  if(fielded(b.k)){order.concat(Object.keys(f).filter(function(k){return order.indexOf(k)<0;})).forEach(function(k){
      // a field change keeps an empty from or to: the field had no value, or was cleared
      if(f[k]!==undefined&&(f[k]!==''||(b.k==='comment'&&f.changed&&(k==='from'||k==='to'))))parts.push(k+': '+ol(f[k]).replace(/[;{}]/g,','));});
    head+=' {'+parts.join('; ')+'}';}
  else head+=ls[0]?' '+ls[0]:'';
  return head+(fielded(b.k)?(b.k==='history'&&b.v===''?[]:ls):ls.slice(1)).map(function(l){return '\n    '+l;}).join('');}
// An Item's fields: due-time goes only beside a due-date, and received-date stands in for received-datetime when only the day is known
var META_ORDER=['type','who','projects','tags','urgency','priority','due-date','due-time','status','dependencies','done-date','received-datetime','received-date'];
// due as one value, "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" ('' for none), and setting it from one: an empty one removes both fields
function dueOf(meta){var d=meta['due-date']||'';return d&&meta['due-time']?d+' '+meta['due-time']:d;}
function setDue(meta,v){var m=/^(\S+)(?: (\d{2}:\d{2}))?/.exec(String(v||'').trim());delete meta['due-date'];delete meta['due-time'];
  if(m){meta['due-date']=m[1];if(m[2])meta['due-time']=m[2];}}
// when an Item reached the User: received-datetime, or received-date when only the day is known ('' for neither)
function receivedOf(meta){return meta['received-datetime']||meta['received-date']||'';}
function serItem(it){
  var parts=metaParts(it.meta,META_ORDER);
  var s='- ['+(it.done?'x':' ')+'] '+it.id+' '+ol(it.title)+(parts.length?' {'+parts.join('; ')+'}':'');
  it.subs.forEach(function(b){s+='\n'+serSub(b);});
  return s;}
// where each kind of sub-line goes on an Item, a Person and a Project or System: a new one goes after the last of its rank or lower
var ITEM_RANK={origin:0,description:1,link:2,'source-key':3,comment:4,sub:5},PERSON_RANK={description:0,history:1,comment:2},ENT_RANK={description:0,link:1,comment:2};
function placeSub(x,b,rank){var at=-1,r=rank[b.k];x.subs.forEach(function(s,k){if(rank[s.k]!==undefined&&rank[s.k]<=r)at=k;});x.subs.splice(at+1,0,b);return b;}
// the Description's text ('' for none), and setting it: an empty one removes the line
function descOf(x){var d=x.subs.filter(function(b){return b.k==='description';})[0];return d?d.v:'';}
// text the User or an Agent gives, as it is written: no spaces at the ends of its lines, and no blank lines before or after it
function cleanText(s){return nl(s).split('\n').map(function(l){return l.replace(/\s+$/,'');}).join('\n').replace(/^\n+|\n+$/g,'');}
function setDesc(x,text,rank){var t=cleanText(text),at=-1,k=0;
  // only one Description is kept, where the first was
  x.subs=x.subs.filter(function(b){if(b.k!=='description'){k++;return true;}if(at<0)at=k;return false;});
  if(!t)return;
  if(at>=0)x.subs.splice(at,0,{k:'description',v:t});
  else placeSub(x,{k:'description',v:t},rank);}
// Comments oldest first as written. A Comment to acknowledge carries acknowledged: no until the User acknowledges it.
function commentsOf(x){return x.subs.filter(function(b){return b.k==='comment';});}
function toAck(c){return /^no$/i.test(String((c.f||{}).acknowledged||''));}
function addComment(x,c,rank){var f={};f['added-datetime']=c.at;f.author=c.author;if(c.ack)f.acknowledged='no';
  Object.keys(c.fields||{}).forEach(function(k){f[k]=c.fields[k];});
  return placeSub(x,{k:'comment',f:f,v:cleanText(c.text)},rank);}
// A Skill changes only these fields, with a Comment to acknowledge naming the field and its old and new value (discern change).
// Closing an Item stays the User's: news that it is finished is a Comment that suggests: done.
var CHANGE_FIELDS={T:['due-date','due-time','status','who'],P:['title','company','department','manager']};
// a Comment's field change -> {field, from, to}, from '' when the field had no value and to '' when it was cleared; null for none
function fieldChange(c){var f=(c&&c.f)||{};return f.changed?{field:f.changed,from:f.from||'',to:f.to||''}:null;}
// Undo shows only on the latest unacknowledged change to a field, and goes back to the value from before the first of them,
// acknowledging them all -> {field, value, which: [[idx, text]]}, or null for any other Comment
function changeUndo(x,c){var g=fieldChange(c);if(!g||!toAck(c))return null;
  var list=commentsOf(x),same=byTime(list.filter(function(b){var h=fieldChange(b);return !!h&&h.field===g.field&&toAck(b);}));
  if(same[same.length-1]!==c)return null;
  return {field:g.field,value:fieldChange(same[0]).from,which:same.map(function(b){return [list.indexOf(b),b.v];})};}
function serialize(model){var post=model.post||[];
  return model.pre.join('\n')+'\n'+model.items.map(serItem).join('\n')+(model.items.length?'\n':'')+(post.length?'\n'+post.join('\n')+'\n':'');}
// change Proposals under "## Changes" in INBOX.md: "- <what> {key: value; …}" then "  - why: …", the braces parsed from the final " {"
var CHANGE_KINDS=[[/^Relate ((?:T|P|PRJ|SYS)-\d+) and ((?:T|P|PRJ|SYS)-\d+)$/,'relationship',['a','b']],[/^New person (.+)$/,'person',['name']],
  [/^Add email (\S+) to (.+) \((P-\d+)\)$/,'email',['email','name','id']],[/^Make (.+) \((P-\d+)\) a Priority person$/,'priority',['name','id']]];
function fieldsOf(s){var f={};s.split(';').forEach(function(p){var i=p.indexOf(':');if(i>0)f[p.slice(0,i).trim()]=p.slice(i+1).trim();});return f;}
// -> [{type: relationship|person|email|priority|'', line, lines, at, fields, why, a, b | name, email | email, name, id | name, id}], at its index in post
function changesOf(post){var out=[],cur=null;
  (post||[]).forEach(function(ln,at){
    var m=/^- (.*)$/.exec(ln);
    if(m){var t=m[1],f={},bi=t.lastIndexOf(' {');if(bi>-1&&t.charAt(t.length-1)==='}'){f=fieldsOf(t.slice(bi+2,-1));t=t.slice(0,bi);}
      cur={type:'',line:ln,lines:[ln],at:at,text:t.trim(),fields:f,why:''};
      for(var k=0;k<CHANGE_KINDS.length;k++){var x=CHANGE_KINDS[k][0].exec(cur.text);if(x){cur.type=CHANGE_KINDS[k][1];CHANGE_KINDS[k][2].forEach(function(n,j){cur[n]=x[j+1].trim();});break;}}
      if(cur.type==='person')cur.email=f.email||'';
      out.push(cur);return;}
    if(cur&&/^ {2,}\S/.test(ln)){cur.lines.push(ln);var w=/^ {2,}- why: ?(.*)$/.exec(ln);if(w)cur.why=w[1];return;}
    cur=null;});
  return out;}
// the IGNORED.md source key a No to a change writes: rel|<id>|<id> (matched in either order), person|<address>, or priority|<P-id>
function changeKey(c){return c.type==='relationship'?'rel|'+c.a+'|'+c.b:c.type==='priority'?'priority|'+c.id:'person|'+String(c.email||'').toLowerCase();}
// A No to a Priority person is not for good: it pauses them for pause-days in SETTINGS.toml, from the date on its IGNORED.md line
function priorityPaused(ignored,id,today,days){var n=days===undefined?SETTING_RULES.priority['pause-days'][0]:days;return ignoredOf(ignored).some(function(g){
  var d=g.fields['ignored-date']||'';return g.key==='priority|'+id&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&daysBetween(d,today)<n;});}
// A subset of TOML, for the App folder's config.toml and the data folder's SETTINGS.toml: comments, blank lines, [table] headings,
// and key = value with a basic or literal string, an integer or a boolean.
// -> {top:{key:{value,line}},tables:{name:{key:{value,line}}},firstTable,lines,eol}, line being the index in lines.
// Anything else throws an Error naming the file and line; given onError, it calls onError({line,key,message}) with the 1-based line
// and goes on to the next line instead. key is there when the line's value is what's wrong.
var TOML_UNESCAPE={b:'\b',t:'\t',n:'\n',f:'\f',r:'\r','"':'"','\\':'\\'};
function parseToml(text,file,onError){
  text=String(text);
  var eol=/\r\n/.test(text)?'\r\n':'\n',lines=text.split(/\r?\n/),top=Object.create(null),tables=Object.create(null),cur=top,firstTable=-1;
  function oneLine(ln,i){
    var where=file+' line '+(i+1);
    var rest=function(s,key){if(!/^\s*(#.*)?$/.test(s)){var e=new Error(where+': unexpected "'+s.trim()+'" after the value; put a comment after #');e.key=key;throw e;}};
    if(/^\s*(#.*)?$/.test(ln))return;
    var h=/^\s*\[\s*([A-Za-z0-9_-]+)\s*\](.*)$/.exec(ln);
    if(h){
      rest(h[2]);
      var again=tables[h[1]];
      cur=again||(tables[h[1]]=Object.create(null));
      if(again)throw new Error(where+': ['+h[1]+'] appears twice; keep one');
      if(firstTable<0)firstTable=i;
      return;}
    var kv=/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(ln);
    if(!kv)throw new Error(where+': "'+ln.trim()+'" is not key = value, a [table] heading or a # comment');
    var key=kv[1],v=kv[2],m,value,e;
    if((m=/^'([^'\r\n]*)'(.*)$/.exec(v)))value=m[1];
    else if((m=/^"((?:[^"\\]|\\.)*)"(.*)$/.exec(v))){
      value=m[1].replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g,function(s,c){
        if(c.length>1)return String.fromCodePoint(parseInt(c.slice(1),16));
        if(!(c in TOML_UNESCAPE)){e=new Error(where+': \\'+c+' is not an escape TOML knows; write \\\\ for a backslash, or use single quotes');e.key=key;throw e;}
        return TOML_UNESCAPE[c];});}
    else if((m=/^([+-]?(?:0|[1-9](?:_?\d)*))(?![\w.:-])(.*)$/.exec(v)))value=Number(m[1].replace(/_/g,''));
    else if((m=/^(true|false)(?![\w.-])(.*)$/.exec(v)))value=m[1]==='true';
    else{e=new Error(where+': the value of '+key+' must be a \'string\', a "string", a whole number, true or false');e.key=key;throw e;}
    rest(m[m.length-1],key);
    if(cur[key])throw new Error(where+': '+key+' is set twice; keep one');
    cur[key]={value:value,line:i};
  }
  lines.forEach(function(ln,i){
    try{oneLine(ln,i);}
    catch(e){if(!onError)throw e;onError({line:i+1,key:e.key,message:e.message});}});
  return {top:top,tables:tables,firstTable:firstTable,lines:lines,eol:eol};}
// SETTINGS.toml in the data folder, which only the User edits, and what each setting may be: [default, lowest, highest]
var SETTINGS_FILE='SETTINGS.toml';
var SETTING_RULES={priority:{'pause-days':[28,1]},score:{'half-life-days':[30,1],'high-percent':[20,1,99],'min-people':[10,1]},weights:{message:[2,0],comment:[2,0],linked:[2,0],reply:[1,0],done:[1,0]}};
function settingRule(table,key){var has=Object.prototype.hasOwnProperty,t=has.call(SETTING_RULES,table)?SETTING_RULES[table]:null;return t&&has.call(t,key)?t[key]:null;}
// -> {values:{table:{key:number}},errors:[{line,message}],warnings:[{line,message}]}. A missing file (''), key or table is the default and
// nothing to report. An invalid value is the default and an error, a key it doesn't know is a warning, and no line stops the others being read.
function readSettings(text){
  var values={},errors=[],warnings=[],table='',unknownAt={};
  Object.keys(SETTING_RULES).forEach(function(t){values[t]={};Object.keys(SETTING_RULES[t]).forEach(function(k){values[t][k]=SETTING_RULES[t][k][0];});});
  function at(line){return SETTINGS_FILE+' line '+line+': ';}
  function unknown(line,t,k){if(unknownAt[line])return;unknownAt[line]=1;warnings.push({line:line,message:at(line)+(t?'['+t+'] ':'')+k+' is not a setting Discerny knows, so it does nothing'});}
  function refuse(line,k,r,shown){var want=r[2]!==undefined?'a whole number from '+r[1]+' to '+r[2]:'a whole number of at least '+r[1];
    errors.push({line:line,message:at(line)+k+' must be '+want+', not '+shown+', so it uses the default, '+r[0]});}
  // the table each line falls under, for an error raised before the line is stored
  var src=String(text||''),under=src.split(/\r?\n/).map(function(ln){var h=/^\s*\[\s*([A-Za-z0-9_-]+)\s*\]/.exec(ln);if(h)table=h[1];return table;});
  var cfg=parseToml(src,SETTINGS_FILE,function(p){
    if(!p.key){errors.push({line:p.line,message:p.message});return;}
    var t=under[p.line-1],r=settingRule(t,p.key);
    if(!r){unknown(p.line,t,p.key);return;}
    refuse(p.line,p.key,r,src.split(/\r?\n/)[p.line-1].replace(/^[^=]*=\s*/,'').replace(/\s+#.*$/,'').trim());});
  function look(t,kv){Object.keys(kv).forEach(function(k){
    var r=settingRule(t,k),e=kv[k],line=e.line+1;
    if(!r){unknown(line,t,k);return;}
    var v=e.value;
    if(typeof v!=='number'||v<r[1]||(r[2]!==undefined&&v>r[2])){refuse(line,k,r,typeof v==='string'?'"'+v+'"':String(v));return;}
    values[t][k]=v;});}
  look('',cfg.top);
  Object.keys(cfg.tables).forEach(function(t){look(t,cfg.tables[t]);});
  errors.sort(function(a,b){return a.line-b.line;});
  warnings.sort(function(a,b){return a.line-b.line;});
  return {values:values,errors:errors,warnings:warnings};}
// IGNORED.md: "- <source key> {ignored-date: YYYY-MM-DD; reason: not actionable}", the braces parsed from the final " {"
// -> [{key, fields, line, at}], at the line's index
function ignoredOf(text){var out=[];String(text||'').replace(/\r/g,'').split('\n').forEach(function(ln,at){
    var m=/^- (.*)$/.exec(ln);if(!m)return;var t=m[1],f={},bi=t.lastIndexOf(' {');
    if(bi>-1&&t.charAt(t.length-1)==='}'){f=fieldsOf(t.slice(bi+2,-1));t=t.slice(0,bi);}
    t=t.trim();if(/^[a-z][a-z0-9-]*\|/i.test(t))out.push({key:t,fields:f,line:ln,at:at});});
  return out;}
function ignoredLine(key,date,reason){var r=ol(reason||'').replace(/[;{}]/g,',').trim();
  return '- '+ol(key).trim()+' {ignored-date: '+date+(r?'; reason: '+r:'')+'}';}
function nextId(model){var n=0;model.pre.forEach(function(l){var m=/next-id:\s*(\d+)/.exec(l);if(m)n=parseInt(m[1],10);});
  model.items.forEach(function(i){var k=parseInt(i.id.slice(2),10);if(k>=n)n=k+1;});return n;}
function setNextId(model,n){var f=false;model.pre=model.pre.map(function(l){if(/next-id:/.test(l)){f=true;return '<!-- next-id: '+n+' -->';}return l;});
  if(!f)model.pre.push('<!-- next-id: '+n+' -->');}
function fmtId(n){return 'T-'+('0000'+n).slice(-4);}
function getSub(it,k){return it.subs.filter(function(b){return b.k===k;});}
// ---- people (PEOPLE.md): "## Group" headings, "- Name {id: P-0002; company: …; department: …; title: …; manager: …; external: yes;
// status: left; checked-date: YYYY-MM-DD; emails: a, b; handles: a, b}" + description, history and comment lines
var PFIELDS=['company','department','title','manager'];
var PLABEL={company:'Company',department:'Department',title:'Job title',manager:'Reports to',group:'Group',emails:'Email',status:'Status'};
var PMETA_ORDER=['id','company','department','title','manager','external','status','checked-date','emails','handles'];
// P-0001 is always the User, and never anyone else
var USER_ID='P-0001';
function pParse(text){
  var lines=String(text||'').replace(/\r/g,'').split('\n');var pre=[],people=[],cur=null,grp='Other',started=false,gtext={},gorder=[];
  lines.forEach(textLines(function(ln){
    var h=/^## (.*)$/.exec(ln);
    if(h){grp=h[1].trim()||'Other';started=true;cur=null;if(gorder.indexOf(grp)<0)gorder.push(grp);return;}
    var m=/^- (.+)$/.exec(ln);
    if(m){started=true;var rest=m[1],meta={},bi=rest.lastIndexOf(' {');
      if(bi>-1&&rest.charAt(rest.length-1)==='}'){meta=parseMeta(rest.slice(bi+2,-1));rest=rest.slice(0,bi);}
      cur={name:rest.trim(),grp:grp,meta:meta,subs:[]};people.push(cur);return;}
    if(!started){pre.push(ln);return;}
    if(ln.trim()==='')return;
    if(!cur){(gtext[grp]=gtext[grp]||[]).push(ln);return;}
    var s=/^  - (description|history|comment): ?(.*)$/.exec(ln);
    if(s){cur.subs.push(textSub(s[1],s[2]));return;}
    cur.subs.push({k:'raw',v:ln});},function(){return cur;}));
  while(pre.length&&pre[pre.length-1].trim()==='')pre.pop();
  return {pre:pre,people:people,gtext:gtext,gorder:gorder};}
function pSerItem(p){
  var parts=metaParts(p.meta,PMETA_ORDER);
  var s='- '+ol(p.name)+(parts.length?' {'+parts.join('; ')+'}':'');
  p.subs.forEach(function(b){s+='\n'+serSub(b);});
  return s;}
function pSerialize(model){
  var order=(model.gorder||[]).slice(),gt=model.gtext||{};model.people.forEach(function(p){var g=p.grp||'Other';if(order.indexOf(g)<0)order.push(g);});
  var out=model.pre.slice();
  order.forEach(function(g){out.push('');out.push('## '+g);(gt[g]||[]).forEach(function(l){out.push(l);});model.people.forEach(function(p){if((p.grp||'Other')===g)out.push(pSerItem(p));});});
  return out.join('\n')+'\n';}
function pMissing(p){return PFIELDS.filter(function(k){return !p.meta[k];});}
// A change to a Person's field, kept as a history line: the field as PEOPLE.md names it (group for a move to another heading)
function histSub(date,field,from,to){var f={'changed-date':date};if(field)f.changed=field;return {k:'history',f:f,v:(from||'(none)')+' → '+(to||'(none)')};}
function addHistory(p,date,field,from,to){return placeSub(p,histSub(date,field,from,to),PERSON_RANK);}
// person IDs (P-####, permanent, never reused; counter lives in a next-id comment in PEOPLE.md)
function fmtPId(n){return 'P-'+('0000'+n).slice(-4);}
function pNextId(model){var n=0;model.pre.forEach(function(l){var m=/next-id:\s*(\d+)/.exec(l);if(m)n=parseInt(m[1],10);});
  model.people.forEach(function(p){var m=/^P-(\d+)$/.exec(p.meta.id||'');if(m&&parseInt(m[1],10)>=n)n=parseInt(m[1],10)+1;});return n;}
function pSetNextId(model,n){var f=false;model.pre=model.pre.map(function(l){if(/next-id:/.test(l)){f=true;return '<!-- next-id: '+n+' -->';}return l;});
  if(!f)model.pre.push('<!-- next-id: '+n+' -->');}
function ensurePIds(model){var n=pNextId(model),c=0;
  model.people.forEach(function(p){if(!/^P-\d+$/.test(p.meta.id||'')){p.meta.id=fmtPId(n++);c++;}});
  if(c||!model.pre.some(function(l){return /next-id:/.test(l);}))pSetNextId(model,n);return c;}
// task dependencies: dependencies: T-0012, T-0015 means "blocked by"
function depList(i){return String(i.meta.dependencies||'').split(/[ ,]+/).filter(Boolean);}
// ask-agent queue (ASK-AGENT.md): "- T-0012 {requested-datetime: 2026-10-06 14:32}" ("requested-date: YYYY-MM-DD" when only the
// day is known), then the request on the lines below it, indented 4 spaces
var NOTE_RE=/^- ((?:T|P|PRJ|SYS)-\d+) \{([^{}\n]*)\}(?=\n|$)/;
// -> {lines, notes: [{id, ts, text, raw}]}: an entry and its request's lines are one element of lines, and raw is that element
function aParse(text){var lines=[];
  String(text||'').replace(/\r/g,'').split('\n').forEach(function(ln){var k=lines.length-1;
    if(k>=0&&/^ {4}/.test(ln)&&NOTE_RE.test(lines[k]))lines[k]+='\n'+ln;else lines.push(ln);});
  if(lines.length&&lines[lines.length-1]==='')lines.pop();
  var notes=[];lines.forEach(function(ln){var m=NOTE_RE.exec(ln);if(!m)return;var f=fieldsOf(m[2]);
    notes.push({id:m[1],ts:f['requested-datetime']||f['requested-date']||'',text:ln.split('\n').slice(1).map(function(l){return l.slice(4);}).join('\n'),raw:ln});});
  return {lines:lines,notes:notes};}
// an entry as aParse keeps it: its line, then the request's lines
function aLine(id,ts,text){var t=cleanText(text);
  return '- '+id+' {'+(/ \d{2}:\d{2}$/.test(ts)?'requested-datetime: ':'requested-date: ')+ts+'}'+(t?t.split('\n').map(function(l){return '\n    '+l;}).join(''):'');}
// ask-agent log (ASK-AGENT-LOG.md): "- T-0012 {requested-datetime: …; actioned-datetime: …}", then "  - request: …" and
// "  - result: …", each going on over lines indented 4 spaces
var LOG_RE=/^- ((?:T|P|PRJ|SYS)-\d+) \{([^{}]*)\}$/;
// -> [{id, at, queued, note, did, raw}]: at when it was actioned, queued when it was requested, note the request, did the result
function logParse(text){var out=[],cur=null,sub=null;
  String(text||'').replace(/\r/g,'').split('\n').forEach(function(ln){
    var m=LOG_RE.exec(ln);
    if(m){var f=fieldsOf(m[2]);sub=null;
      cur={id:m[1],at:f['actioned-datetime']||f['actioned-date']||'',queued:f['requested-datetime']||f['requested-date']||'',note:'',did:'',raw:ln};out.push(cur);return;}
    if(!cur)return;
    var c=sub&&/^ {4}(.*)$/.exec(ln);
    if(c){cur[sub]+='\n'+c[1];cur.raw+='\n'+ln;return;}
    var s=/^  - (request|result): ?(.*)$/.exec(ln);
    if(s){sub=s[1]==='request'?'note':'did';cur[sub]=s[2];cur.raw+='\n'+ln;return;}
    if(/^  \S/.test(ln)){sub=null;cur.raw+='\n'+ln;return;}
    cur=sub=null;});
  return out;}
// ---- tags / projects / systems / relationships (PROJECTS.md, SYSTEMS.md, RELATIONSHIPS.md)
function csv(s){return String(s||'').split(',').map(function(x){return x.trim();}).filter(Boolean);}
function tagsOf(i){return csv(i.meta.tags);}
function prjOf(i){return csv(i.meta.projects);}
function cleanTag(s){return String(s||'').replace(/[;,{}]/g,' ').replace(/\s+/g,' ').trim();}
var EMETA_ORDER=['id','type','owner','parent','part-of','status'];
function eParse(text){
  var lines=String(text||'').replace(/\r/g,'').split('\n');var pre=[],ents=[],cur=null,grp='',started=false,gtext={},gorder=[];
  lines.forEach(textLines(function(ln){
    var h=/^## (.*)$/.exec(ln);
    if(h){grp=h[1].trim();started=true;cur=null;if(gorder.indexOf(grp)<0)gorder.push(grp);return;}
    var m=/^- (.+)$/.exec(ln);
    if(m){started=true;var rest=m[1],meta={},bi=rest.lastIndexOf(' {');
      if(bi>-1&&rest.charAt(rest.length-1)==='}'){meta=parseMeta(rest.slice(bi+2,-1));rest=rest.slice(0,bi);}
      cur={name:rest.trim(),grp:grp,meta:meta,subs:[]};ents.push(cur);return;}
    if(!started){pre.push(ln);return;}
    if(ln.trim()==='')return;
    if(!cur){(gtext[grp]=gtext[grp]||[]).push(ln);return;}
    var s=/^  - (description|link|comment): ?(.*)$/.exec(ln);
    if(s){cur.subs.push(s[1]==='link'?{k:s[1],v:s[2]}:textSub(s[1],s[2]));return;}
    cur.subs.push({k:'raw',v:ln});},function(){return cur;}));
  while(pre.length&&pre[pre.length-1].trim()==='')pre.pop();
  return {pre:pre,ents:ents,gtext:gtext,gorder:gorder};}
function eSerItem(e){
  var parts=metaParts(e.meta,EMETA_ORDER);
  var s='- '+ol(e.name)+(parts.length?' {'+parts.join('; ')+'}':'');
  e.subs.forEach(function(b){s+='\n'+serSub(b);});
  return s;}
function eSerialize(model){
  var order=(model.gorder||[]).slice(),gt=model.gtext||{};model.ents.forEach(function(e){var g=e.grp||'';if(order.indexOf(g)<0)order.push(g);});
  var u=order.indexOf('');if(u>0){order.splice(u,1);order.unshift('');}
  var out=model.pre.slice();
  order.forEach(function(g){out.push('');if(g)out.push('## '+g);(gt[g]||[]).forEach(function(l){out.push(l);});model.ents.forEach(function(e){if((e.grp||'')===g)out.push(eSerItem(e));});});
  return out.join('\n')+'\n';}
function fmtEId(kind,n){return kind+'-'+('0000'+n).slice(-4);}
function eNextId(model,kind){var n=0,re=new RegExp('^'+kind+'-(\\d+)$');
  model.pre.forEach(function(l){var m=/next-id:\s*(\d+)/.exec(l);if(m)n=parseInt(m[1],10);});
  model.ents.forEach(function(e){var m=re.exec(e.meta.id||'');if(m&&parseInt(m[1],10)>=n)n=parseInt(m[1],10)+1;});return n||1;}
function eSetNextId(model,n){var f=false;model.pre=model.pre.map(function(l){if(/next-id:/.test(l)){f=true;return '<!-- next-id: '+n+' -->';}return l;});
  if(!f)model.pre.push('<!-- next-id: '+n+' -->');}
function ensureEIds(model,kind){var n=eNextId(model,kind),c=0,re=new RegExp('^'+kind+'-\\d+$');
  model.ents.forEach(function(e){if(!re.test(e.meta.id||'')){e.meta.id=fmtEId(kind,n++);c++;}});
  if(c||!model.pre.some(function(l){return /next-id:/.test(l);}))eSetNextId(model,n);return c;}
// relationships: "- T-0007 ~ T-0032 {kind: related}" (symmetric, stored once) or "- T-0014 -> SYS-0002 {kind: concerns}"; the kind is m[4]
var REL_RE=/^- ((?:T|P|PRJ|SYS)-\d+) (~|->) ((?:T|P|PRJ|SYS)-\d+) \{(?:[^{}]*?;\s*)?kind:\s*([^;{}]*?)\s*(?:;[^{}]*)?\}$/;
function rParse(text){var lines=String(text||'').replace(/\r/g,'').split('\n');if(lines.length&&lines[lines.length-1]==='')lines.pop();
  var rels=[];lines.forEach(function(ln){var m=REL_RE.exec(ln);if(m)rels.push({a:m[1],op:m[2],b:m[3],type:m[4].trim(),raw:ln});});
  return {lines:lines,rels:rels};}
function kindOf(id){return String(id).split('-')[0];}
var REL_PAIRS={'T|SYS':'concerns','T|P':'involves','P|SYS':'owns','PRJ|SYS':'uses'};
function relLine(a,b){
  if(a===b)return {err:'Nothing can be related to itself.'};
  var ka=kindOf(a),kb=kindOf(b);
  if(ka===kb&&ka!=='PRJ'){var s=[a,b].sort();return {line:'- '+s[0]+' ~ '+s[1]+' {kind: related}'};}
  var k1=ka+'|'+kb,k2=kb+'|'+ka;
  if(REL_PAIRS[k1])return {line:'- '+a+' -> '+b+' {kind: '+REL_PAIRS[k1]+'}'};
  if(REL_PAIRS[k2])return {line:'- '+b+' -> '+a+' {kind: '+REL_PAIRS[k2]+'}'};
  return {err:'Cannot relate '+ka+' to '+kb+' (an item joins a project through its Project field).'};}
// SOURCES.md: a Person's ID added to priority-people in "## defaults" (on), or taken out of it, every other line kept as it was
function setPriority(text,id,on){
  var t=String(text||''),eol=/\r\n/.test(t)?'\r\n':'\n',ls=t.split(/\r?\n/),d=-1,end=-1,at=-1,i;
  for(i=0;i<ls.length;i++){
    if(/^## /.test(ls[i])){if(d>=0)break;if(/^## defaults\s*$/.test(ls[i]))d=end=i;continue;}
    if(d<0)continue;
    if(/^ *- /.test(ls[i]))end=i;
    if(/^- priority-people:/.test(ls[i]))at=i;}
  if(at<0){
    if(!on)return t;
    if(d<0){var f=ls.findIndex(function(l){return /^## /.test(l);});if(f<0)f=ls.length&&ls[ls.length-1]===''?ls.length-1:ls.length;ls.splice(f,0,'## defaults','- priority-people: '+id,'');}
    else ls.splice(end+1,0,'- priority-people: '+id);
    return ls.join(eol);}
  var v=ls[at].replace(/^- priority-people:\s*/,''),sub=[];
  for(i=at+1;i<ls.length&&/^ {2,}- /.test(ls[i]);i++)sub.push(i);
  if(!v.trim()&&sub.length){
    var has=sub.filter(function(k){return ls[k].replace(/^ {2,}- /,'').trim()===id;});
    if(on&&!has.length)ls.splice(sub[sub.length-1]+1,0,'  - '+id);
    if(!on)has.reverse().forEach(function(k){ls.splice(k,1);});}
  else{var ids=csv(v);if(on&&ids.indexOf(id)<0)ids.push(id);if(!on)ids=ids.filter(function(x){return x!==id;});ls[at]='- priority-people:'+(ids.length?' '+ids.join(', '):'');}
  return ls.join(eol);}
// SOURCES.md: the IDs in priority-people in "## defaults", on its one line or as a list under it
function priorityIds(text){
  var ls=String(text||'').split(/\r?\n/),d=false,out=[],i;
  for(i=0;i<ls.length;i++){
    if(/^## /.test(ls[i])){if(d)break;d=/^## defaults\s*$/.test(ls[i]);continue;}
    if(!d||!/^- priority-people:/.test(ls[i]))continue;
    out=csv(ls[i].replace(/^- priority-people:\s*/,''));
    if(!out.length)for(i++;i<ls.length&&/^ {2,}- /.test(ls[i]);i++)out.push(ls[i].replace(/^ {2,}- /,'').trim());
    break;}
  return out;}
// Where a Person stands: 'user' never counts, 'manager' (the User's) always does, listed or not; everyone else is 'on' or 'off' priority-people
function priorityStatus(people,ids,p){
  if(p.meta.id===USER_ID)return 'user';
  var me=people.filter(function(x){return x.meta.id===USER_ID;})[0];
  if(me&&me.meta.manager&&me.meta.manager===p.name)return 'manager';
  return ids.indexOf(p.meta.id)>=0?'on':'off';}
// versions compare part by part, a missing part counting as 0; 'next' (an unlanded Migration) is newer than any
function versionCmp(a,b){if(a===b)return 0;if(a==='next')return 1;if(b==='next')return -1;
  var x=String(a).split('.'),y=String(b).split('.');
  for(var i=0;i<Math.max(x.length,y.length);i++){var d=(+x[i]||0)-(+y[i]||0);if(d)return d<0?-1:1;}return 0;}
// DISCERNY.md records a data folder's Format version as <!-- format: <version> -->; no file or no comment means 0.1.0.0
function formatOf(text){var m=/<!--\s*format:\s*(\S+?)\s*-->/.exec(String(text||''));return m?m[1]:'0.1.0.0';}
// how a folder's Format version stands against this app's: 'same', 'older' or 'newer'
function formatIs(v){var c=versionCmp(v,FORMAT);return c?(c<0?'older':'newer'):'same';}
// the all-items workbench: items grouped and sorted as the User chooses -> [{key, label, items}]
function workbench(items,o){
  var by=o.group,groups={},keys=[];
  function keysOf(i){if(by==='tag')return tagsOf(i).length?tagsOf(i):[''];if(by==='type')return [i.meta.type||'task'];
    if(by==='project')return prjOf(i).length?prjOf(i):[''];
    if(by==='person'){var w=i.meta.who||'';return [w==='Unassigned'?'':w];}return [i.meta.urgency||'later'];}
  if(o.tag)items=items.filter(function(i){return tagsOf(i).indexOf(o.tag)>=0;});
  if(o.q)items=items.filter(function(i){return itemMatch(i,o.q,o.prjName)!==null;});
  items.forEach(function(i){keysOf(i).forEach(function(k){if(!groups[k]){groups[k]=[];keys.push(k);}groups[k].push(i);});});
  function label(k){if(by==='urg')return URG[k]||k;if(by==='type')return TYPE_LABEL[k]||k;
    if(by==='project')return k?(o.prjName&&o.prjName(k))||k:'Not in a project';return k||(by==='person'?'Unassigned':'Untagged');}
  var fixed=by==='urg'?URG_ORDER:by==='type'?TYPES:null;
  function rank(k){var n=fixed.indexOf(k);return n<0?fixed.length:n;}
  if(fixed)keys.sort(function(a,b){return rank(a)-rank(b)||a.localeCompare(b);});
  else if(by==='project')keys.sort(function(a,b){return (a==='')-(b==='')||label(a).localeCompare(label(b));});
  else keys.sort(function(a,b){return (a==='')-(b==='')||groups[b].length-groups[a].length||a.localeCompare(b);});
  function urgRank(i){var n=URG_ORDER.indexOf(i.meta.urgency||'later');return n<0?URG_ORDER.indexOf('later'):n;}
  function byUrg(a,b){return urgRank(a)-urgRank(b);}
  function byDue(a,b){return String(dueOf(a.meta)||'9999').localeCompare(String(dueOf(b.meta)||'9999'));}
  function first(x,y){return function(a,b){return x(a,b)||y(a,b);};}
  function byReceived(dir){return function(a,b){var x=receivedOf(a.meta),y=receivedOf(b.meta);return (!x)-(!y)||dir*x.localeCompare(y);};}
  var lead=o.sort==='due'?first(byDue,byUrg):o.sort==='new'?byReceived(-1):o.sort==='old'?byReceived(1):first(byUrg,byDue);
  function cmp(a,b){return lead(a,b)||(prioRank(a.meta.priority)-prioRank(b.meta.priority))||(a.id<b.id?-1:a.id>b.id?1:0);}
  return keys.map(function(k){return {key:k,label:label(k),items:groups[k].slice().sort(cmp)};});}
// search: every word of the query must start a word in the item. Returns where it matched ('' for the ID, title, person
// or tags) or null. Where is the first place holding every word, else the first holding a word the title line lacks.
function tokensOf(hay){return String(hay).toLowerCase().split(/[^a-z0-9À-ɏ-]+/).filter(Boolean);}
function itemMatch(i,q,prjName){
  var words=tokensOf(q);if(!words.length)return '';
  function sv(k){return getSub(i,k).map(function(b){return b.v;}).join(' ');}
  var places=[['',i.id+' '+i.title+' '+(i.meta.who||'')+' '+tagsOf(i).join(' ')],
    ['project',prjOf(i).map(function(p){return (prjName&&prjName(p))||p;}).join(' ')],
    ['the description',descOf(i)],['comments',sv('comment')],['sub-tasks',sv('sub')],['the source',sv('origin')]]
    .map(function(p){return {where:p[0],toks:tokensOf(p[1])};});
  function has(p,w){return p.toks.some(function(t){return t.indexOf(w)===0;});}
  if(!words.every(function(w){return places.some(function(p){return has(p,w);});}))return null;
  var full=places.filter(function(p){return words.every(function(w){return has(p,w);});})[0];
  if(full)return full.where;
  var rest=words.filter(function(w){return !has(places[0],w);});
  return places.filter(function(p){return rest.some(function(w){return has(p,w);});})[0].where;}
// quick add: parseQuick's result plus what the User chose -> {title, meta, description} for the new item
function daysBetween(a,b){function t(s){var p=String(s).slice(0,10).split('-').map(Number);return Date.UTC(p[0],p[1]-1,p[2]);}return Math.round((t(b)-t(a))/86400000);}
function urgForDue(due,today){var n=daysBetween(today,due);return n<=0?'today':(n<=7?'this week':(n<=14?'soon':'later'));}
// overdue: open and due on a day before today. A Meeting is overdue from the day after it takes place, not from its start time
function isOverdue(i,today){var d=String(i.meta['due-date']||'');return !i.done&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&daysBetween(today,d)<0;}
// Snooze: the new due date is today plus the step in days, a Saturday or Sunday moved to the Monday, keeping the old due date's
// time of day. due and the result are one value, as dueOf gives it and setDue takes it.
function snooze(due,days,today){var p=String(today).slice(0,10).split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]+days));
  var w=d.getUTCDay();if(w===6||w===0)d.setUTCDate(d.getUTCDate()+(w===6?2:1));
  var t=/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(String(due||''));
  return d.toISOString().slice(0,10)+(t?' '+t[1]:'');}
// q.ty is a type as TYPES or TYPE_NAME has it, and q.p a priority as PRIORITIES has it, or 1, 2 or 3 for high, medium or low
function quickItem(q,o){
  var due=q.date?q.date+(q.time?' '+q.time:''):'',type=String(q.ty||'task').toLowerCase();
  var meta={type:TYPES.indexOf(type)>=0?type:'task'};
  if(q.who)meta.who=q.who;
  if(q.prj.length)meta.projects=q.prj.join(', ');
  if(q.tags.length)meta.tags=q.tags.join(', ');
  meta.urgency=o.urg||(meta.type==='fyi'?'fyi':(due?urgForDue(due,o.today):'this week'));
  meta.priority=PRIORITIES.indexOf(q.p)>=0?q.p:PRIORITIES[+q.p-1]||'medium';
  if(due)setDue(meta,due);
  meta['received-datetime']=o.now;
  var description=cleanText(o.description);
  return {title:q.title,meta:meta,description:description};}
// the timezone setting in SOURCES.md's "## defaults" block ('' when it has none)
function tzOf(text){var d=false,z='';String(text||'').replace(/\r/g,'').split('\n').some(function(l){
    if(/^## /.test(l)){if(d)return true;d=/^## defaults\s*$/.test(l);return false;}
    var m=d&&/^- timezone:\s*(.*?)\s*$/.exec(l);if(m)z=m[1];return false;});return z;}
// an instant as local "YYYY-MM-DD HH:MM" in a time zone, the way the helper writes times; the browser's own zone for none or an unknown one
function stampIn(tz,ms){try{var o={};new Intl.DateTimeFormat('en-GB',{timeZone:tz||undefined,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
    .formatToParts(new Date(ms)).forEach(function(p){o[p.type]=p.value;});return o.year+'-'+o.month+'-'+o.day+' '+o.hour+':'+o.minute;}
  catch(e){return tz?stampIn('',ms):'';}}
// Comments in time order, the undated ones (older than any stamp) first; those with the same time keep their order
function byTime(list){return list.map(function(c,k){return {c:c,k:k,t:String((c.f||{})['added-datetime']||'')};})
  .sort(function(a,b){return a.t<b.t?-1:a.t>b.t?1:a.k-b.k;}).map(function(x){return x.c;});}
// ---- The Interaction log, INTERACTIONS.md: one line per event, "- YYYY-MM-DD P-#### <kind> T-####", or per decision, "- YYYY-MM-DD P-#### decision <what> {score: …}".
// The Interaction score is worked out from it whenever it's read, and is never stored.
var INTERACTIONS_FILE='INTERACTIONS.md';
var INTER_HEAD=['# Interactions',
  '<!-- The log the Interaction score is worked out from, keyed by P-ID. One line per event, written as it gets past the Inbox:',
  '     `- YYYY-MM-DD P-#### <kind> T-####`, the kind being message, comment, linked, reply or done.',
  '     One line per decision about a Priority person, with the score and breakdown at that moment:',
  '     `- YYYY-MM-DD P-#### decision <yes|no|promote|demote|start> {score: …; message: …; half-life-days: …}`.',
  '     `{inferred: yes}` marks a line an Upgrade inferred from older data. discerny.html and tools/discern.mjs write this file. -->',''];
var INTER_KINDS=['message','comment','linked','reply','done'],INTER_DECISIONS=['yes','no','promote','demote','start'];
// There's at most one of these for each Person on each Item; comment and reply can repeat.
var INTER_ONCE=['message','linked','done'];
// What a Proposal's interaction field may be: what it counts as when it's accepted, none being nothing
var PROPOSAL_INTERACTIONS=['message','reply','linked','none'];
var INTER_LINE=/^- (\S+) (\S+) (\S+) (\S+)(?: \{([^{}]*)\})?$/;
function realDay(d){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''));if(!m)return false;var t=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return t.getUTCFullYear()===+m[1]&&t.getUTCMonth()===+m[2]-1&&t.getUTCDate()===+m[3];}
// one line -> {date, person, kind, item | decision, fields, line}, or null for a line that isn't one
function interactionOf(ln){var m=INTER_LINE.exec(ln);
  if(!m)return null;
  var o={date:m[1],person:m[2],kind:m[3],fields:m[5]?fieldsOf(m[5]):{},line:ln};
  if(m[3]==='decision')o.decision=m[4];else o.item=m[4];
  return o;}
// the events and decisions in the log's text, with at, each one's index among its lines
function interactionsOf(text){var out=[];String(text||'').replace(/\r/g,'').split('\n').forEach(function(ln,at){if(ln.slice(0,2)!=='- ')return;var o=interactionOf(ln);if(o){o.at=at;out.push(o);}});return out;}
// what's wrong with the log's lines -> [{line, message}], line being 1-based. An ID needn't still exist: a deleted Item's events stay.
function checkInteractions(text){var out=[],open=false;
  String(text||'').replace(/\r/g,'').split('\n').forEach(function(ln,i){
    var inC=open;if(ln.indexOf('<!--')>=0)inC=open=true;if(ln.indexOf('-->')>=0)open=false;
    if(inC||!ln.trim()||/^#/.test(ln))return;
    function no(m){out.push({line:i+1,message:INTERACTIONS_FILE+' line '+(i+1)+': '+m});}
    var o=/^- /.test(ln)?interactionOf(ln):null;
    if(!o){no('"'+ln.trim().slice(0,60)+'" is not in the shape of an event or a decision');return;}
    if(!realDay(o.date))no('the date "'+o.date+'" must be a real date, YYYY-MM-DD');
    if(!/^P-\d+$/.test(o.person))no('"'+o.person+'" must be a Person\'s ID, P-####');
    if(o.kind==='decision'){if(INTER_DECISIONS.indexOf(o.decision)<0)no('the decision "'+o.decision+'" must be one of '+INTER_DECISIONS.join(', '));}
    else{if(INTER_KINDS.indexOf(o.kind)<0)no('the kind "'+o.kind+'" must be one of '+INTER_KINDS.join(', ')+', or decision');
      if(!/^T-\d+$/.test(o.item))no('"'+o.item+'" must be an Item\'s ID, T-####');}});
  return out;}
function interactionLine(e){var f=e.fields||{},parts=Object.keys(f).map(function(k){return k+': '+f[k];});
  return '- '+e.date+' '+e.person+' '+e.kind+' '+(e.kind==='decision'?e.decision:e.item)+(parts.length?' {'+parts.join('; ')+'}':'');}
function interactionText(text){var t=String(text||'');return t.trim()?t:INTER_HEAD.join('\n')+'\n';}
function interactionAdd(t,line){if(t.slice(-1)!=='\n')t+='\n';return t+line+'\n';}
// The log with these events written, unless that would repeat a one-per-Item kind -> {text, added: [the lines written]}
function addInteractions(text,events){var t=interactionText(text),have={},added=[];
  function key(e){return e.person+'|'+e.kind+'|'+e.item;}
  interactionsOf(t).forEach(function(e){if(INTER_ONCE.indexOf(e.kind)>=0)have[key(e)]=1;});
  events.forEach(function(e){
    if(INTER_ONCE.indexOf(e.kind)>=0){if(have[key(e)])return;have[key(e)]=1;}
    var l=interactionLine(e);t=interactionAdd(t,l);added.push(l);});
  return {text:added.length?t:String(text||''),added:added};}
// One line out for each line named, so what an action wrote goes even when an identical line remains from another.
function dropInteractions(text,lines){var ls=String(text||'').split('\n');
  for(var i=lines.length-1;i>=0;i--){var k=ls.lastIndexOf(lines[i]);if(k>=0)ls.splice(k,1);}
  return ls.join('\n');}
// The lines test picks taken out -> {text, removed: [[line, where it was]]}, which restoreInteractions puts back
function removeInteractions(text,test){var removed=[],ls=String(text||'').split('\n');
  var keep=ls.filter(function(ln,at){var o=ln.slice(0,2)==='- '?interactionOf(ln):null;if(o&&test(o)){removed.push([ln,at]);return false;}return true;});
  return {text:removed.length?keep.join('\n'):String(text||''),removed:removed};}
function restoreInteractions(text,removed){if(!removed||!removed.length)return String(text||'');var ls=interactionText(text).split('\n');
  removed.forEach(function(r){ls.splice(Math.min(r[1],ls.length&&ls[ls.length-1]===''?ls.length-1:ls.length),0,r[0]);});
  return ls.join('\n');}
// values as readSettings gives them; a table or key that's missing is the default
function settingOf(values,table,key){var t=values&&values[table];return t&&typeof t[key]==='number'?t[key]:SETTING_RULES[table][key][0];}
function noScore(){var s={};INTER_KINDS.forEach(function(k){s[k]=0;});return {total:0,shares:s};}
// score = the sum of weight(kind) x 0.5 ^ (age in days / half-life-days), an event dated in the future being age 0. Inferred events weigh the same; decisions don't count.
// log is the file's text or interactionsOf's result -> {P-id: {total, shares: {kind: its part of the total}}}
function interactionScores(log,values,today){var out={},half=settingOf(values,'score','half-life-days');
  (typeof log==='string'?interactionsOf(log):log||[]).forEach(function(e){
    if(INTER_KINDS.indexOf(e.kind)<0||!realDay(e.date))return;
    var s=out[e.person]||(out[e.person]=noScore()),n=settingOf(values,'weights',e.kind)*Math.pow(0.5,Math.max(daysBetween(e.date,today),0)/half);
    s.shares[e.kind]+=n;s.total+=n;});
  return out;}
function interactionScore(log,id,values,today){return interactionScores(log,values,today)[id]||noScore();}
// A plain account of a Person's score: each kind that adds anything, the most first, then when most of it comes from.
// log is as for interactionScores.
function scoreExplanation(log,id,values,today){var half=settingOf(values,'score','half-life-days'),n={},add={},total=0,count=0,week=0,month=0,quarter=0,seen=0;
  (typeof log==='string'?interactionsOf(log):log||[]).forEach(function(e){
    if(e.person!==id||INTER_KINDS.indexOf(e.kind)<0||!realDay(e.date))return;
    seen++;var w=settingOf(values,'weights',e.kind);if(!w)return;
    var age=Math.max(daysBetween(e.date,today),0),v=w*Math.pow(0.5,age/half);
    n[e.kind]=(n[e.kind]||0)+1;add[e.kind]=(add[e.kind]||0)+v;total+=v;count++;
    if(age<=7)week+=v;if(age<=30)month+=v;if(age<=90)quarter+=v;});
  if(!seen)return 'No Interactions yet';
  if(!count)return seen+' Interactions, none of them counting under your weights';
  var words={message:['message','messages'],reply:['reply','replies'],comment:['comment','comments'],linked:['linked','linked'],done:['done','done']};
  var parts=Object.keys(n).sort(function(a,b){return add[b]-add[a]||INTER_KINDS.indexOf(a)-INTER_KINDS.indexOf(b);}).map(function(k){return n[k]+' '+words[k][n[k]===1?0:1];});
  var when=week>total/2?'this week':month>total/2?'this month':quarter>total/2?'the last three months':'longer ago';
  return parts.join(', ')+', '+(count>1?'mostly ':'')+when;}
// Who a score is for: everyone with an ID but the User and anyone who has left
function scoreable(p){return !!p.meta.id&&p.meta.id!==USER_ID&&p.meta.status!=='left';}
// The review filters. people as in PEOPLE.md, ids priority-people, scores as interactionScores gives them, by P-ID.
// Scored people are those scoreable with at least one Interaction. Totals closer than a rounding error count as tied.
// -> {scored, needs, enough, high: [P-id], low: [P-id]}, both lists empty when there aren't enough scored people to compare
function reviewLists(people,ids,scores,values){var EPS=1e-9,needs=settingOf(values,'score','min-people');
  var scored=people.filter(function(p){return scoreable(p)&&scores[p.meta.id];}),n=scored.length,out={scored:n,needs:needs,enough:n>=needs,high:[],low:[]};
  if(!out.enough)return out;
  var totals=scored.map(function(p){return scores[p.meta.id].total;}).sort(function(a,b){return b-a;});
  var cut=totals[Math.min(Math.ceil(n*settingOf(values,'score','high-percent')/100),n)-1];
  var median=n%2?totals[(n-1)/2]:(totals[n/2-1]+totals[n/2])/2;
  people.forEach(function(p){if(!scoreable(p))return;var s=scores[p.meta.id],st=priorityStatus(people,ids,p);
    if(st==='off'&&s&&s.total>=cut-EPS)out.high.push(p.meta.id);
    if(st==='on'&&(!s||s.total<median-EPS))out.low.push(p.meta.id);});
  return out;}
function tenths(n){return Math.round(n*10)/10;}
// A decision's line: with a score, the score and each kind's share at that moment
function decisionLine(date,person,decision,score,half){var f;
  if(score){f={score:tenths(score.total)};INTER_KINDS.forEach(function(k){f[k]=tenths(score.shares[k]);});f['half-life-days']=half;}
  return interactionLine({date:date,person:person,kind:'decision',decision:decision,fields:f});}
// Who can get credit: someone in PEOPLE.md other than the User -> their P-ID, or ''. Unassigned, and a name not there, are no one.
function creditById(people,id){return id&&id!==USER_ID&&people.some(function(p){return p.meta.id===id;})?id:'';}
function creditByName(people,name){var p=name?people.filter(function(x){return x.name===name;})[0]:null;return p&&/^P-\d+$/.test(p.meta.id||'')&&p.meta.id!==USER_ID?p.meta.id:'';}
function dayOf(s){var m=/^\d{4}-\d{2}-\d{2}/.exec(String(s||''));return m?m[0]:'';}
// A none Proposal counts for nothing, unless the User changed its who while it waited. who-proposed keeps the who the Skill wrote, '-' if it wrote none,
// from the User's first change until they change it back. was is who before this change.
var WHO_PROPOSED='who-proposed',NO_WHO='-';
function proposedWho(it){var w=it.meta[WHO_PROPOSED];return w===NO_WHO?'':w;}
function whoByUser(it,was){if(it.meta.interaction!=='none')return;var from=proposedWho(it);if(from===undefined)from=was;
  if((it.meta.who||'')===from)delete it.meta[WHO_PROPOSED];else it.meta[WHO_PROPOSED]=from||NO_WHO;}
// Accept or Already handled: the Proposal's interaction, credited to who as it is now, dated when the Item reached the User.
// A who the User changed on a none Proposal is linked, as it would have been had they changed it after accepting, so it's dated today.
function acceptEvents(it,people,today){var k=it.meta.interaction,pid=creditByName(people,it.meta.who),from=proposedWho(it);
  if(k==='none')return from!==undefined&&from!==(it.meta.who||'')?linkedEvents(pid,it.id,today):[];
  return pid&&k&&PROPOSAL_INTERACTIONS.indexOf(k)>=0?[{date:dayOf(receivedOf(it.meta))||today,person:pid,kind:k,item:it.id}]:[];}
// Acknowledging a Comment on an Item: news is a comment, credited to its sender, else who; a change of who is linked, credited to the new one.
// A Comment from the calendar, the User or an Agent is nothing.
function ackEvents(it,c,people,today){var f=c.f||{},g=fieldChange(c),date=dayOf(f['added-datetime'])||today,pid;
  if(['calendar','user','agent'].indexOf(f.author)>=0)return [];
  if(g&&g.field==='who'){pid=creditByName(people,g.to);return pid?[{date:date,person:pid,kind:'linked',item:it.id}]:[];}
  pid=f.sender?creditById(people,f.sender):creditByName(people,it.meta.who);
  return pid?[{date:date,person:pid,kind:'comment',item:it.id}]:[];}
function doneEvents(it,people,date){var pid=creditByName(people,it.meta.who);return pid?[{date:date,person:pid,kind:'done',item:it.id}]:[];}
function linkedEvents(pid,id,date){return pid?[{date:date,person:pid,kind:'linked',item:id}]:[];}
// ---- Merge: a duplicate Item d folded into the Item s it duplicates, which keeps its ID. Meetings never merge.
function canMerge(s,d){return !!s&&!!d&&s.id!==d.id&&s.meta.type!=='meeting'&&d.meta.type!=='meeting';}
// due a before due b: the earlier day, and on the same day a time before none or a later one
function dueBefore(a,b){var x=String(a).slice(0,10),y=String(b).slice(0,10);if(x!==y)return x<y;
  var ta=String(a).slice(11),tb=String(b).slice(11);return !!ta&&(!tb||ta<tb);}
function union(a,b){var out=[];a.concat(b).forEach(function(x){if(out.indexOf(x)<0)out.push(x);});return out;}
// s gains d's fields: priority the higher, urgency the sooner, due the earlier; title and type s's; who s's, else d's; Projects, tags,
// Dependencies, URLs, Source keys and sub-tasks combined; d's Description after s's under "From <d>:"; both Comment trails in time
// order; then a Comment from the User saying so, at `at`. One of them done and the other open leaves s open and In progress.
function mergeItem(s,d,at){
  var sm=s.meta,dm=d.meta;
  function urgRank(u){var n=URG_ORDER.indexOf(u);return n<0?URG_ORDER.indexOf('later'):n;}
  function real(w){return w&&w!=='Unassigned';}
  if(dm.priority&&(!sm.priority||prioRank(dm.priority)<prioRank(sm.priority)))sm.priority=dm.priority;
  if(dm.urgency&&(!sm.urgency||urgRank(dm.urgency)<urgRank(sm.urgency)))sm.urgency=dm.urgency;
  if(dueOf(dm)&&(!dueOf(sm)||dueBefore(dueOf(dm),dueOf(sm))))setDue(sm,dueOf(dm));
  if(!real(sm.who)&&real(dm.who))sm.who=dm.who;
  if(!receivedOf(sm)&&receivedOf(dm)){if(dm['received-datetime'])sm['received-datetime']=dm['received-datetime'];else sm['received-date']=dm['received-date'];}
  var prj=union(prjOf(s),prjOf(d));if(prj.length)sm.projects=prj.join(', ');
  var tg=union(tagsOf(s),tagsOf(d));if(tg.length)sm.tags=tg.join(', ');
  var dep=union(depList(s),depList(d)).filter(function(x){return x!==s.id&&x!==d.id;});if(dep.length)sm.dependencies=dep.join(', ');else delete sm.dependencies;
  if(s.done!==d.done){s.done=false;delete sm['done-date'];sm.status='in progress';}
  else if(!s.done&&!sm.status&&dm.status)sm.status=dm.status;
  if(s.done&&!sm['done-date']&&dm['done-date'])sm['done-date']=dm['done-date'];
  var dd=descOf(d);if(dd.trim()){var sd=descOf(s);setDesc(s,(sd?sd+'\n\n':'')+'From '+d.id+':\n'+dd,ITEM_RANK);}
  d.subs.forEach(function(b){
    if(b.k==='origin'||b.k==='link'||b.k==='source-key'){if(!s.subs.some(function(x){return x.k===b.k&&x.v.trim()===b.v.trim();}))placeSub(s,{k:b.k,v:b.v},ITEM_RANK);}
    else if(b.k==='sub'){var have=s.subs.filter(function(x){return x.k==='sub'&&x.v===b.v;})[0];if(have)have.x=have.x||b.x;else placeSub(s,{k:'sub',v:b.v,x:b.x},ITEM_RANK);}
    else if(b.k==='raw'&&b.v.trim())s.subs.push({k:'raw',v:b.v});});
  var cs=byTime(commentsOf(s).concat(commentsOf(d)));
  s.subs=s.subs.filter(function(b){return b.k!=='comment';});
  cs.forEach(function(c){placeSub(s,{k:'comment',f:Object.assign({},c.f),v:c.v},ITEM_RANK);});
  addComment(s,{at:at,author:'user',text:'Merged '+d.id+' into this.'},ITEM_RANK);
  return s;}
// the lines of RELATIONSHIPS.md ('rels'), ASK-AGENT.md ('asks', the entries as aParse keeps them), ASK-AGENT-LOG.md ('log'),
// IGNORED.md ('ignored') or INTERACTIONS.md ('interactions') that name d, made to name s. A Relationship or a No to one that would then
// repeat another, or join s to itself, goes, as does an event of a kind there's one of per Item.
// -> {lines, swaps: [[the old line, the new one or null, where the old one was]]}
var IGN_REL_RE=/^(- rel\|)((?:T|P|PRJ|SYS)-\d+)\|((?:T|P|PRJ|SYS)-\d+)( \{[^{}]*\})$/;
function mergeRefs(kind,lines,d,s){
  function to(x){return x===d?s:x;}
  function moved(ln){var m;
    if(kind==='rels'&&(m=REL_RE.exec(ln))&&(m[1]===d||m[3]===d)){var a=to(m[1]),b=to(m[3]);if(a===b)return null;
      if(m[2]==='~'&&b<a){var t=a;a=b;b=t;}return '- '+a+' '+m[2]+' '+b+ln.slice(ln.lastIndexOf(' {'));}
    if(kind==='asks'&&(m=NOTE_RE.exec(ln))&&m[1]===d)return '- '+s+ln.slice(2+d.length);
    if(kind==='log'&&(m=LOG_RE.exec(ln))&&m[1]===d)return '- '+s+ln.slice(2+d.length);
    if(kind==='ignored'&&(m=IGN_REL_RE.exec(ln))&&(m[2]===d||m[3]===d)){if(to(m[2])===to(m[3]))return null;return m[1]+to(m[2])+'|'+to(m[3])+m[4];}
    if(kind==='interactions'&&ln.slice(0,2)==='- '&&(m=interactionOf(ln))&&m.item===d)return ln.replace(' '+m.kind+' '+d,' '+m.kind+' '+s);
    return undefined;}
  function key(ln){var m;
    if(kind==='rels'&&(m=REL_RE.exec(ln)))return m[2]==='~'?[m[1],m[3]].sort().join('~'):m[1]+'->'+m[3];
    if(kind==='ignored'&&(m=IGN_REL_RE.exec(ln)))return [m[2],m[3]].sort().join('|');
    if(kind==='interactions'&&ln.slice(0,2)==='- '&&(m=interactionOf(ln))&&INTER_ONCE.indexOf(m.kind)>=0)return m.person+'|'+m.kind+'|'+m.item;
    return null;}
  var seen={},swaps=[],out=[];
  lines.forEach(function(ln){if(moved(ln)===undefined){var k=key(ln);if(k)seen[k]=1;}});
  lines.forEach(function(ln,at){var n=moved(ln);
    if(n===undefined){out.push(ln);return;}
    var k=n===null?null:key(n);
    if(n===null||(k&&seen[k])){swaps.push([ln,null,at]);return;}
    if(k)seen[k]=1;out.push(n);swaps.push([ln,n,at]);});
  return {lines:out,swaps:swaps};}
// The data folder files the page reads and writes; `discern serve` serves these, and SETTINGS_FILE for reading, and no others.
var FILES = { tasks: 'TASKS.md', inbox: 'INBOX.md', done: 'DONE.md', people: 'PEOPLE.md', projects: 'PROJECTS.md', systems: 'SYSTEMS.md', rels: 'RELATIONSHIPS.md', asks: 'ASK-AGENT.md', asklog: 'ASK-AGENT-LOG.md', ignored: 'IGNORED.md', dismissed: 'DISMISSED.md', settings: 'SOURCES.md', interactions: 'INTERACTIONS.md' };
var WATCH = ['TASKS.md', 'INBOX.md', 'DONE.md', 'PEOPLE.md', 'PROJECTS.md', 'SYSTEMS.md', 'RELATIONSHIPS.md', 'ASK-AGENT.md', 'ASK-AGENT-LOG.md', 'SOURCES.md', 'DISCERNY.md', 'INTERACTIONS.md'];
// The header the page writes when it creates a missing RELATIONSHIPS.md, DISMISSED.md or ASK-AGENT.md: the starter file's, word for word.
var REL_HEAD = ['# Relationships',
  '<!-- One line per Relationship, stored once (shown on both):',
  '     `- A ~ B {kind: related}` (symmetric) or `- A -> B {kind: <kind>}` (involves, concerns, owns, uses).',
  '     Validate: both IDs exist, no duplicates, nothing related to itself.',
  '     `dependencies` on Items are separate. -->', ''];
var DIS_HEAD = ['# Dismissed',
  '<!-- One line per source key of a Proposal the user dismissed, kept until its source can no longer read',
  '     the message again: `- <source key> {source: <source name>; received-datetime: YYYY-MM-DD HH:MM;',
  '     dismissed-date: YYYY-MM-DD; reason: not actionable}`, local time in `timezone`.',
  '     A line from a horizon source has `event-date: YYYY-MM-DD` in place of `received-datetime`.',
  '     Parse the braces from the final " {".',
  '     tools/discern.mjs removes a line on commit once its source has moved past it. -->', ''];
var ASK_HEAD = ['# Ask agent queue',
  '<!-- The agent queue, written by discerny.html. One entry per agent request:',
  '     `- <ID> {requested-datetime: YYYY-MM-DD HH:MM}`, then the request on the lines below it, indented 4 spaces.',
  '     The agent removes an entry once it is actioned (skill: discern-ask-agent) and records it in ASK-AGENT-LOG.md. -->', ''];

// What the rest of the UI, the helper and the tests use. Every later concern adds its own D.<concern>.
var D = { core: {
  VERSION: VERSION, FORMAT: FORMAT, URG: URG, URG_ORDER: URG_ORDER, TYPES: TYPES, TYPE_NAME: TYPE_NAME,
  STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, PRIORITIES: PRIORITIES, PRIORITY_LABEL: PRIORITY_LABEL,
  prioRank: prioRank, ol: ol, nl: nl, CHANGES_HEAD: CHANGES_HEAD, parse: parse, serSub: serSub, dueOf: dueOf,
  setDue: setDue, receivedOf: receivedOf, serItem: serItem, ITEM_RANK: ITEM_RANK, PERSON_RANK: PERSON_RANK,
  ENT_RANK: ENT_RANK, placeSub: placeSub, descOf: descOf, cleanText: cleanText, setDesc: setDesc,
  commentsOf: commentsOf, toAck: toAck, addComment: addComment, CHANGE_FIELDS: CHANGE_FIELDS,
  fieldChange: fieldChange, changeUndo: changeUndo, serialize: serialize, changesOf: changesOf,
  changeKey: changeKey, priorityPaused: priorityPaused, parseToml: parseToml, SETTINGS_FILE: SETTINGS_FILE,
  readSettings: readSettings, ignoredOf: ignoredOf, ignoredLine: ignoredLine, nextId: nextId,
  setNextId: setNextId, fmtId: fmtId, getSub: getSub, PFIELDS: PFIELDS, PLABEL: PLABEL, USER_ID: USER_ID,
  pParse: pParse, pSerItem: pSerItem, pSerialize: pSerialize, histSub: histSub, addHistory: addHistory,
  pNextId: pNextId, pSetNextId: pSetNextId, ensurePIds: ensurePIds, depList: depList, NOTE_RE: NOTE_RE,
  aParse: aParse, aLine: aLine, LOG_RE: LOG_RE, logParse: logParse, csv: csv, tagsOf: tagsOf, prjOf: prjOf,
  cleanTag: cleanTag, eParse: eParse, eSerItem: eSerItem, eSerialize: eSerialize, fmtEId: fmtEId,
  eNextId: eNextId, eSetNextId: eSetNextId, ensureEIds: ensureEIds, REL_RE: REL_RE, rParse: rParse,
  kindOf: kindOf, relLine: relLine, setPriority: setPriority, priorityIds: priorityIds,
  priorityStatus: priorityStatus, versionCmp: versionCmp, formatOf: formatOf, formatIs: formatIs,
  workbench: workbench, tokensOf: tokensOf, itemMatch: itemMatch, urgForDue: urgForDue, isOverdue: isOverdue,
  snooze: snooze, quickItem: quickItem, tzOf: tzOf, stampIn: stampIn, byTime: byTime,
  INTERACTIONS_FILE: INTERACTIONS_FILE, INTER_HEAD: INTER_HEAD, INTER_KINDS: INTER_KINDS,
  PROPOSAL_INTERACTIONS: PROPOSAL_INTERACTIONS, realDay: realDay, interactionOf: interactionOf,
  interactionsOf: interactionsOf, checkInteractions: checkInteractions, interactionText: interactionText,
  interactionAdd: interactionAdd, addInteractions: addInteractions, dropInteractions: dropInteractions,
  removeInteractions: removeInteractions, restoreInteractions: restoreInteractions,
  interactionScores: interactionScores, interactionScore: interactionScore,
  scoreExplanation: scoreExplanation, scoreable: scoreable, reviewLists: reviewLists, tenths: tenths,
  decisionLine: decisionLine, creditById: creditById, creditByName: creditByName, whoByUser: whoByUser,
  acceptEvents: acceptEvents, ackEvents: ackEvents, doneEvents: doneEvents, linkedEvents: linkedEvents,
  canMerge: canMerge, union: union, mergeItem: mergeItem, mergeRefs: mergeRefs, FILES: FILES, WATCH: WATCH,
  REL_HEAD: REL_HEAD, DIS_HEAD: DIS_HEAD, ASK_HEAD: ASK_HEAD
} };
