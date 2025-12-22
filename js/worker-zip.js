importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
self.onmessage=async e=>{
    const {content,config}=e.data,z=new JSZip();
    const rx=/(?:^|\n)(?:\\+)?\=== File:\s*(.*?)\s*===/g;
    let m,files=[],cnt=0;
    while((m=rx.exec(content))!==null) files.push({p:m[1].trim(),idx:m.index+m[0].length,start:m.index});
    if(!files.length)return self.postMessage({success:false,error:"no_tags"});
    files.forEach((curr,i)=>{
        const next=files[i+1],raw=content.substring(curr.idx,next?next.start:undefined).trim();
        let cln=raw;
        if(/^\s*```/.test(raw)&&/```\s*$/.test(raw)){
            const s=raw.indexOf('\n'),e=raw.lastIndexOf('```');
            if(s>-1&&e>s) cln=raw.substring(s+1,e);
        }
        z.file(curr.p,cln.replaceAll(config.ESCAPED_TOKEN,config.MAGIC_TOKEN));cnt++;
    });
    try{const b=await z.generateAsync({type:"blob"});self.postMessage({success:true,blob:b,count:cnt});}
    catch(err){self.postMessage({success:false,error:err.message});}
};