const Logic={
    getActive:()=>STATE.files.filter(f=>!f.excluded),
    genTree:()=>{
        const t={},f=Logic.getActive();
        f.forEach(x=>x.path.split('/').reduce((r,k)=>r[k]=r[k]||{},t));
        const p=(n,pre="")=>Object.keys(n).sort().map((k,i,a)=>{
            const last=i===a.length-1,str=pre+(last?"└── ":"├── ")+k+"\n";
            return str+(Object.keys(n[k]).length?p(n[k],pre+(last?"    ":"│   ")):"");
        }).join('');
        return `Project: ${STATE.projectName}\nRoot/\n${p(t)}`;
    },
    renderTree:()=>{
        if(UI.areas.treeContainer.hasChildNodes()&&!STATE.needsTreeRebuild)return Logic.syncVisuals();
        UI.areas.treeContainer.innerHTML='';
        const t={};STATE.files.forEach(f=>f.path.split('/').reduce((r,k,i,a)=>r[k]=r[k]||(i===a.length-1?"__F__":{}),t));
        const build=(n,pre="",fp="")=>Object.keys(n).sort().map((k,i,a)=>{
            const isF=n[k]==="__F__",last=i===a.length-1,cf=fp?`${fp}/${k}`:k;
            return `<div class="tree-node ${isF?'tree-node--file':''}" ${isF?`data-path="${cf}" onclick="Logic.toggle('${cf}')"`:""}>
                <span style="opacity:0.5">${pre+(last?"└── ":"├── ")}</span>
                <span class="node-label ${isF?'':'tree-node--folder'}">${k}</span>
            </div>${isF?"":build(n[k],pre+(last?"    ":"│   "),cf)}`;
        }).join('');
        UI.areas.treeContainer.innerHTML=`<div class="tree-node"><span class="tree-node--folder">Project: ${STATE.projectName}</span></div>`+build(t);
        STATE.needsTreeRebuild=false;Logic.syncVisuals();
    },
    syncVisuals:()=>{
        UI.areas.treeContainer.querySelectorAll('.tree-node--file').forEach(n=>{
            const f=STATE.files.find(x=>x.path===n.dataset.path);
            if(f) n.classList.toggle('is-disabled',!!f.excluded);
        });
        Logic.updStats();
    },
    toggle:p=>{const f=STATE.files.find(x=>x.path===p);if(f){f.excluded=!f.excluded;UI.areas.treeViewer.value=Logic.genTree();Logic.syncVisuals();}},
    updStats:()=>{
        const f=Logic.getActive();UI.stats.fileCount.innerText=f.length;
        UI.stats.tokenCount.innerText=`~${Utils.estimateTokens(f.map(x=>x.content).join("")).toLocaleString()}`;
    },
    render:()=>{UI.areas.treeViewer.value=Logic.genTree();Logic.renderTree();Logic.updStats();},
    merge:()=>{
        const f=Logic.getActive();
        if(!f.length)return Utils.showToast(UI_TEXT.toast.noMergeFiles,"error");
        const c=f.map(x=>`${MAGIC_TOKEN} ${x.path} ===\n\`\`\`${getLangFromExt(x.path)}\n${x.content.replaceAll(MAGIC_TOKEN,ESCAPED_TOKEN)}\n\`\`\`\n`).join("\n");
        UI.areas.preview.value=`${UI_TEXT.prompt.header}${Logic.genTree()}\n${"=".repeat(48)}\n\n${c}`;
        UI.areas.preview.parentElement.scrollIntoView({behavior:'smooth',block:'start'});
        Utils.showToast(UI_TEXT.toast.mergeSuccess(f.length));
    },
    zip:()=>{
        const c=UI.areas.restore.value||"";
        if(!c.trim())return Utils.showToast(UI_TEXT.toast.restoreFail,"error");
        Utils.showToast("Packaging...","info");
        const w=new Worker('js/worker-zip.js');
        w.postMessage({content:c,config:{MAGIC_TOKEN,ESCAPED_TOKEN}});
        w.onmessage=e=>{
            e.data.success?(saveAs(e.data.blob,`${STATE.projectName}_restore_${Utils.getTimestamp()}.zip`),Utils.showToast(UI_TEXT.toast.restoreSuccess(e.data.count))):Utils.showToast(e.data.error==='no_tags'?UI_TEXT.toast.restoreNoTag:"Error: "+e.data.error,"error");
            w.terminate();
        };
        w.onerror=()=>{Utils.showToast("Worker Error","error");w.terminate();};
    }
};
const PatchLogic={
    states:new Map(), base:new Map(),
    regBase:(n,c)=>PatchLogic.base.set(n,c),
    preview:()=>{
        const v=UI.areas.patch.value;
        if(!v.trim())return Utils.showToast(UI_TEXT.toast.patchEmpty,"error");
        Utils.showToast("Analyzing...","info");UI.areas.diff.innerHTML='<div style="text-align:center;padding:20px;">⏳ ...</div>';
        const fd={};for(const[n,c]of PatchLogic.base)fd[n]=c;STATE.files.forEach(f=>fd[f.path.replace(/^\.\//,'')]=f.content);
        const w=new Worker('js/worker-diff.js');
        w.postMessage({patchInput:v,filesData:fd});
        w.onmessage=e=>{
            if(!e.data.success){UI.areas.diff.innerHTML="";Utils.showToast(e.data.error==='invalid_patch'?UI_TEXT.toast.patchInvalid:"Diff Error","error");w.terminate();return;}
            PatchLogic.states.clear();UI.areas.diff.innerHTML="";
            let cnt=0,html="";
            e.data.results.forEach(r=>{
                if(r.error){
                    html+=`<div class="diff-file-wrapper"><div class="diff-file-info" style="color:#ff6b6b">📄 ${Utils.escapeHtml(r.filePath)} (Error)</div><div class="diff-message">${Utils.escapeHtml(r.error)}</div></div>`;
                    return;
                }
                const hs=r.hunks.map(h=>({...h,active:h.isValid}));
                PatchLogic.states.set(r.filePath,{orig:r.originalContent,hunks:hs});
                if(hs.some(h=>h.isValid))cnt++;
                const isBase=PatchLogic.base.has(r.filePath.split('/').pop());
                html+=`<div class="diff-file-wrapper"><div class="diff-file-info"><span>📄 ${Utils.escapeHtml(r.filePath)} <small style="opacity:0.6">${isBase?UI_TEXT.templates.labelBaseline:""}</small></span><span style="font-size:0.8em;opacity:0.8">${hs.length} changes</span></div><div class="diff-hunk-container">`;
                hs.forEach((h,i)=>{
                    const st=h.isValid?"":`background:rgba(255,50,50,0.1);color:#ffaaaa;`,msg=h.isValid?"":`<span style="color:#ff6b6b;margin-right:10px;">⚠️ ${h.validityMsg}</span>`;
                    html+=`<div class="hunk-card ${h.isValid?'':'rejected'}" data-hid="${h.id}"><div class="hunk-header" style="${st}"><span>Change #${i+1}</span><div class="hunk-actions">${msg}<button class="hunk-toggle ${h.isValid?'':'is-rejected'}" onclick="PatchLogic.toggle('${r.filePath}','${h.id}',this)">${h.isValid?'✅ Applied':'❌ Ignored'}</button></div></div><div class="diff-split-view"><div class="diff-pane pane-old">${h.diffHtml.oldHtml}</div><div class="diff-pane pane-new">${h.diffHtml.newHtml}</div></div></div>`;
                });
                html+="</div></div>";
            });
            UI.areas.diff.innerHTML=html;
            cnt>0?(Utils.showToast(UI_TEXT.toast.diffSuccess(e.data.results.length)),UI.areas.diff.parentElement.scrollIntoView({behavior:'smooth',block:'start'})):Utils.showToast("No valid changes","error");
            w.terminate();
        };
    },
    toggle:(fp,hid,btn)=>{
        const s=PatchLogic.states.get(fp),h=s?.hunks.find(x=>x.id===hid);
        if(!h)return;
        h.active=!h.active;
        const c=btn.closest('.hunk-card');
        btn.textContent=h.active?"✅ Applied":"❌ Ignored";
        btn.classList.toggle('is-rejected',!h.active);c.classList.toggle('rejected',!h.active);
    },
    apply:type=>{ // type: 'dl' or 'copy'
        if(!PatchLogic.states.size)return Utils.showToast("No changes","error");
        const res=[];
        for(const[p,s]of PatchLogic.states){
            let c=s.orig,n=0;
            s.hunks.filter(x=>x.active&&x.isValid).forEach(h=>{
                if(c.includes(h.originalSearch)){
                    c = c.replace(h.originalSearch, () => h.replace); 
                    n++;
                }
            });
            if(n>0)res.push({path:p,content:c});
        }
        if(!res.length)return;
        if(type==='copy'){
            if(res.length>1)Utils.showToast("Multiple files changed, copying first only","info");
            Utils.copyToClipboard(res[0].content);
        }else{
            if(res.length===1){
                saveAs(new Blob([res[0].content]),res[0].path.split('/').pop().replace(/(\.[\w\d]+)$/,'_patched$1'));
                Utils.showToast(`Saved: ${res[0].path}`);
            }else{
                const z=new JSZip();res.forEach(f=>z.file(f.path,f.content));
                z.generateAsync({type:"blob"}).then(b=>saveAs(b,`patched_${Utils.getTimestamp()}.zip`));
                Utils.showToast(`Packed ${res.length} files`);
            }
        }
    }
};
const RequirementLogic={
    cfg:()=>JSON.parse(localStorage.getItem('ac_llm')||'{"baseUrl":"https://api.openai.com/v1","model":"gpt-4o","apiKey":""}'),
    save:c=>localStorage.setItem('ac_llm',JSON.stringify(c)),
    call:async(ms)=>{
        const c=RequirementLogic.cfg();if(!c.apiKey)throw new Error("Missing API Key");
        const r=await fetch(`${c.baseUrl.replace(/\/+$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${c.apiKey}`},body:JSON.stringify({model:c.model,messages:ms,temperature:0.7})});
        if(!r.ok)throw new Error((await r.json()).error?.message||"API Failed");
        return (await r.json()).choices[0].message.content;
    },
    opts:async(inp)=>{
        try{
            let t=await RequirementLogic.call([{role:"system",content:`You are a Technical Architect. Analyze user request, determine tech decisions. Output strictly valid JSON (Array of Option Groups) with NO Markdown. Schema: [{"id":"...","title":"...","type":"radio|checkbox","options":[...]}] Always include "Visual Style".`},{role:"user",content:`Req: "${inp}"`}]);
            const s=JSON.parse(t.replace(/^```json\s*/,'').replace(/\s*```$/,''));
            const c=document.getElementById('container-req-options');c.innerHTML='';c.classList.remove('hidden');
            s.forEach((g,i)=>{
                c.innerHTML+=`<div class="option-group-card"><span class="option-group-title">${g.title}</span><div class="option-chips">${g.options.map((o,j)=>`<input type="${g.type}" id="o-${i}-${j}" name="${g.type==='radio'?g.id:''}" class="chip-input" value="${o}" data-t="${g.title}"><label for="o-${i}-${j}" class="chip-label">${o}</label>`).join('')}</div></div>`;
            });
        }catch(e){Utils.showToast(e.message,"error");}
    },
    gen:async()=>{
        const cmd=document.getElementById('input-req-command').value.trim();
        if(!cmd)return Utils.showToast("Input required","error");
        let sel="";document.querySelectorAll('.chip-input:checked').forEach(x=>sel+=`- ${x.dataset.t}: ${x.value}\n`);
        const btn=document.getElementById('action-gen-prompt'),old=btn.innerText;
        btn.innerText="Generating...";btn.disabled=true;
        try{
            const p=await RequirementLogic.call([{role:"system",content:`You are an expert Prompt Engineer. Write a detailed coding prompt. Based on "User Idea" and "Constraints": 1.Expand requirements. 2.Define structure/standards. 3.Output strictly Markdown starting with "# Project Requirement".`},{role:"user",content:`[User Idea]\n${cmd}\n[Constraints]\n${sel||"Best practices"}\n[Context]\nExisting file structure provided.`}]);
            const o=document.getElementById('output-architect-prompt'),rc=document.getElementById('container-final-prompt');
            o.value=p;rc.classList.remove('hidden');o.style.height=(o.scrollHeight+2)+'px';
            rc.scrollIntoView({behavior:'smooth',block:'nearest'});Utils.showToast("Prompt Ready","success");
        }catch(e){Utils.showToast(e.message,"error");}finally{btn.innerText=old;btn.disabled=false;}
    }
};