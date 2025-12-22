const globToRegex=p=>{
    let r=p.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.');
    return new RegExp(`(^|/)${r}(/|$)`);
};
const getLangFromExt=p=>LANG_MAP[p.split('.').pop().toLowerCase()]||'';
const Utils={
    isBinary:f=>BINARY_EXTS.has(f.name.split('.').pop().toLowerCase()),
    readFile:f=>new Promise(r=>{
        if(Utils.isBinary(f))return r(UI_TEXT.toast.binaryOmitted);
        if(f.size>2*1024*1024)return r(UI_TEXT.toast.fileTooLarge);
        const reader=new FileReader();
        reader.onload=e=>{
            const arr=new Uint8Array(e.target.result);
            if(arr.some(b=>b===0)) return r(UI_TEXT.toast.binaryOmitted);
            const fr=new FileReader();
            fr.onload=ev=>r(ev.target.result);
            fr.readAsText(f);
        };
        reader.readAsArrayBuffer(f.slice(0,1024));
    }),
    estimateTokens:t=>{
        if(!t)return 0;
        const cjk=(t.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g)||[]).length;
        const nonCjk=t.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g,' ');
        const tokens=nonCjk.match(/[\w]+|[^\s\w]/g)||[];
        return cjk + tokens.reduce((a,c)=>/^[\w]+$/.test(c)?a+Math.max(1,Math.ceil(c.length/4)):a+1,0);
    },
    shouldIgnore:p=>{
        let ign=false;
        for(const r of STATE.ignoreRules){
            if(!r)continue;
            const neg=r.startsWith('!'), reg=globToRegex(neg?r.slice(1):r);
            if(reg.test(p)) ign=!neg;
        }
        return ign;
    },
    showToast:(msg,type='info')=>{
        const c=document.getElementById('toast-overlay'),el=document.createElement('div');
        el.className='ui-btn';
        el.style.cssText=`margin-top:10px;background:${type==='error'?'#5c1e1e':'#1e5c2e'};border:1px solid rgba(255,255,255,0.2);pointer-events:none;animation:fadeIn 0.3s forwards;`;
        el.innerHTML=msg;
        c.appendChild(el);
        setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),300)},2000);
    },
    copyToClipboard:async t=>{
        if(!t)return Utils.showToast(UI_TEXT.toast.emptyContent,"error");
        try{await navigator.clipboard.writeText(t);Utils.showToast(UI_TEXT.toast.copySuccess);}
        catch(e){Utils.showToast(UI_TEXT.toast.copyFail,"error");}
    },
    getTimestamp:()=>{
        const n=new Date(),pad=i=>String(i).padStart(2,'0');
        return `${n.getFullYear()}${pad(n.getMonth()+1)}${pad(n.getDate())}_${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
    },
    escapeHtml:t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")
};