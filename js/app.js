const $=(i)=>document.getElementById(i);
const App={
    init:async()=>{
        // 1. DOM Cache Mapping
        UI.inputs={dir:$('input-upload-directory'),file:$('input-upload-files'),base:$('input-upload-baseline'),req:$('input-req-command'),url:$('setting-base-url'),key:$('setting-api-key'),model:$('setting-model')};
        UI.areas={treeViewer:$('viewer-file-tree'),preview:$('editor-merge-result'),patch:$('input-patch-source'),diff:$('viewer-diff-result'),restore:$('input-restore-source')};
        UI.stats={fileCount:$('display-file-count'),tokenCount:$('display-token-estimator'),baseName:$('display-baseline-name')};
        UI.modals={settings:$('modal-settings')};
        
        // 2. Init Tree Container
        const tc=document.createElement('div');tc.className='file-tree-widget';tc.id='guiProjectTree';
        UI.areas.treeViewer.parentNode.insertBefore(tc,UI.areas.treeViewer.nextSibling);
        UI.areas.treeViewer.classList.add('hidden');UI.areas.treeContainer=tc;

        // 3. Bindings
        App.txt();App.bind();App.dnd();
        
        // 4. Load Defaults
        try{
            const t=await(await fetch('ignore.txt')).text();
            STATE.ignoreRules.push(...t.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')));
        }catch(e){console.warn("No ignore.txt");}
        
        window.onbeforeunload=()=>STATE.files.length?UI_TEXT.toast.beforeUnload:undefined;
    },
    txt:()=>{
        document.querySelectorAll('[data-i18n]').forEach(el=>{
            const k=el.dataset.i18n,t=k.split('.').reduce((o,i)=>o?o[i]:null,UI_TEXT);
            if(t) el.textContent=t;
        });
        UI.areas.treeContainer.innerHTML=STATE.files.length?UI.areas.treeContainer.innerHTML:UI_TEXT.html.treeWaiting;
        UI.areas.diff.innerHTML=UI.areas.diff.textContent.trim()?UI.areas.diff.innerHTML:UI_TEXT.html.diffEmptyState;
        ['treeViewer','preview','patch','restore'].forEach(k=>UI.areas[k].placeholder=UI_TEXT.placeholder[k==='treeViewer'?'tree':k]);
        $('input-req-command').placeholder=UI_TEXT.placeholder.architectInput;
    },
    lang:()=>{
        STATE.lang=STATE.lang==='zh'?'en':'zh';UI_TEXT=I18N_RESOURCES[STATE.lang];
        App.txt();Utils.showToast(`Language: ${STATE.lang.toUpperCase()}`);
    },
    bind:()=>{
        // Toolbar & Actions
        $('action-switch-lang').onclick=App.lang;
        $('action-settings').onclick=()=>{const c=RequirementLogic.cfg();UI.inputs.url.value=c.baseUrl;UI.inputs.key.value=c.apiKey;UI.inputs.model.value=c.model;UI.modals.settings.classList.remove('hidden');};
        $('action-close-settings').onclick=()=>UI.modals.settings.classList.add('hidden');
        $('action-save-settings').onclick=()=>{RequirementLogic.save({baseUrl:UI.inputs.url.value,apiKey:UI.inputs.key.value,model:UI.inputs.model.value});UI.modals.settings.classList.add('hidden');Utils.showToast("Saved","success");};
        $('action-analyze-req').onclick=()=>RequirementLogic.opts(UI.inputs.req.value);
        $('action-gen-prompt').onclick=RequirementLogic.gen;
        $('action-copy-prompt').onclick=()=>Utils.copyToClipboard($('output-architect-prompt').value);
        $('action-reset-architect').onclick=()=>{UI.inputs.req.value="";$('container-req-options').innerHTML="";$('container-req-options').classList.add('hidden');$('container-final-prompt').classList.add('hidden');};
        
        $('action-import-dir').onclick=()=>UI.inputs.dir.click();
        $('action-append-files').onclick=()=>UI.inputs.file.click();
        $('action-copy-structure').onclick=()=>Utils.copyToClipboard(Logic.genTree());
        $('action-select-all').onclick=()=>{STATE.files.forEach(f=>f.excluded=false);Logic.render();Utils.showToast(UI_TEXT.toast.treeRestored(STATE.files.length));};
        $('action-merge-content').onclick=Logic.merge;
        $('action-reset-workspace').onclick=()=>{
            STATE.files=[];
            STATE.projectName="Project";
            STATE.needsTreeRebuild=true;
            Logic.render();
            Utils.showToast(UI_TEXT.toast.projectCleared);
        };
        
        $('action-copy-result').onclick=()=>Utils.copyToClipboard(UI.areas.preview.value);
        $('action-download-text').onclick=()=>{saveAs(new Blob([UI.areas.preview.value],{type:'text/plain;charset=utf-8'}),`${STATE.projectName}_${Utils.getTimestamp()}.txt`);};
        $('action-clear-result').onclick=()=>UI.areas.preview.value="";
        
        $('action-upload-baseline').onclick=()=>UI.inputs.base.click();
        $('action-preview-patch').onclick=PatchLogic.preview;
        $('action-clear-patch').onclick=()=>UI.areas.patch.value="";
        $('action-clear-diff').onclick=()=>{UI.areas.diff.innerHTML=UI_TEXT.html.diffEmptyState;};
        $('action-apply-download').onclick=()=>PatchLogic.apply('dl');
        $('action-apply-copy').onclick=()=>PatchLogic.apply('copy');
        
        $('action-export-zip').onclick=Logic.zip;
        $('btnClearRestore').onclick=()=>UI.areas.restore.value="";

        // Inputs
        UI.inputs.dir.onchange=async e=>{
            if(!e.target.files.length)return;
            STATE.files=[];STATE.projectName=e.target.files[0].webkitRelativePath.split('/')[0]||"Project";
            let ign=0;const rules=Array.from(e.target.files).filter(f=>f.name==='.gitignore');
            for(const f of rules) STATE.ignoreRules.push(...(await Utils.readFile(f)).split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')));
            if(rules.length) Utils.showToast(UI_TEXT.toast.gitIgnoreDetected(rules.length));
            for(const f of e.target.files){
                const p=f.webkitRelativePath||f.name;
                if(Utils.shouldIgnore(p)){ign++;continue;}
                STATE.files.push({path:p,content:await Utils.readFile(f),originalFile:f});
            }
            STATE.needsTreeRebuild=true;Logic.render();Utils.showToast(UI_TEXT.toast.projectLoaded(STATE.files.length,ign));e.target.value='';
        };
        
        UI.inputs.file.onchange=async e=>{
            for(const f of e.target.files){
                const p="Extra/"+f.name;if(Utils.shouldIgnore(p))continue;
                const c=await Utils.readFile(f),ex=STATE.files.find(x=>x.path===p);
                ex?ex.content=c:STATE.files.push({path:p,content:c,originalFile:f});
            }
            STATE.needsTreeRebuild=true;Logic.render();Utils.showToast(UI_TEXT.toast.addedFiles(e.target.files.length));e.target.value='';
        };

        UI.inputs.base.onchange=async e=>{
            const f=e.target.files[0];if(!f)return;
            PatchLogic.regBase(f.name,await Utils.readFile(f));UI.stats.baseName.innerText=f.name;
            Utils.showToast(UI_TEXT.toast.baselineLoaded(f.name));e.target.value='';
        };
    },
    dnd:()=>{
        const dz=UI.areas.treeContainer;
        ['dragenter','dragover','dragleave','drop'].forEach(n=>dz.addEventListener(n,e=>{e.preventDefault();e.stopPropagation();},false));
        ['dragenter','dragover'].forEach(n=>dz.addEventListener(n,()=>dz.classList.add('is-dragover'),false));
        ['dragleave','drop'].forEach(n=>dz.addEventListener(n,()=>dz.classList.remove('is-dragover'),false));
        dz.addEventListener('drop',async e=>{
            const items=e.dataTransfer.items;if(!items)return;
            const entries=[];for(let i=0;i<items.length;i++){const en=items[i].webkitGetAsEntry();if(en)entries.push(en);}
            Utils.showToast("Parsing...","info");
            STATE.files=[];let cnt=0,ign=0;
            for(const en of entries){
                if(en.isDirectory&&!STATE.files.length) STATE.projectName=en.name;
                await App.scan(en,"",(c,p)=>{
                    if(Utils.shouldIgnore(p)){ign++;return;}
                    STATE.files.push({path:p,content:c});cnt++;
                });
            }
            STATE.needsTreeRebuild=true;Logic.render();Utils.showToast(UI_TEXT.toast.projectLoaded(cnt,ign));
        });
    },
    scan:async(entry,pre,cb)=>{
        const p = pre ? `${pre}/${entry.name}` : entry.name;
        if (Utils.shouldIgnore(p)) return; 

        if(entry.isFile){
            return new Promise(resolve=>entry.file(async f=>{try{cb(await Utils.readFile(f),p);}catch(e){}resolve();},resolve));
        }else if(entry.isDirectory){
            const r=entry.createReader();
            const read=()=>new Promise(res=>r.readEntries(res));
            let arr=[];try{let b;while((b=await read())&&b.length)arr=arr.concat(b);}catch(e){}
            for(const c of arr) await App.scan(c,p,cb);
        }
    }
};
document.addEventListener('DOMContentLoaded',App.init);