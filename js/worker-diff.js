importScripts('https://cdnjs.cloudflare.com/ajax/libs/diff_match_patch/20121119/diff_match_patch.js');
const esc=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
self.onmessage=e=>{
    const {patchInput,filesData}=e.data,dmp=new diff_match_patch(),res=[];
    const rx=/(?:^|\n)(?:\\+)?\=== File:\s*(.*?)\s*===\s*[\r\n]+<<<< SEARCH\s*([\s\S]*?)==== REPLACE\s*([\s\S]*?)>>>>/g;
    let m;const pMap={};
    while((m=rx.exec(patchInput))!==null){
        const p=m[1].trim().replace(/^\.\//,'');
        (pMap[p]=pMap[p]||[]).push({search:m[2],replace:m[3],id:`h-${Math.random().toString(36).slice(2)}`});
    }
    if(!Object.keys(pMap).length)return self.postMessage({success:false,error:"invalid_patch"});
    for(const[fp,hs]of Object.entries(pMap)){
        const orig=filesData[fp]||filesData[fp.split('/').pop()]||null;
        const fRes={filePath:fp,hunks:[],originalContent:orig,error:orig===null?"File not found":null};
        if(orig!==null){
            hs.forEach(h=>{
                const sb=h.search.replace(/\s+$/,''),cnt=orig.split(sb).length-1;
                const d=dmp.diff_main(h.search,h.replace);dmp.diff_cleanupSemantic(d);
                let oh="",nh="";d.forEach(([o,t])=>{const s=esc(t);if(o===0){oh+=s;nh+=s;}else if(o===-1)oh+=`<del>${s}</del>`;else nh+=`<ins>${s}</ins>`;});
                fRes.hunks.push({...h,originalSearch:sb,isValid:cnt===1,validityMsg:cnt===0?"Not Found":(cnt>1?"Ambiguous":"Ready"),diffHtml:{oldHtml:oh,newHtml:nh}});
            });
        }
        res.push(fRes);
    }
    self.postMessage({success:true,results:res});
};