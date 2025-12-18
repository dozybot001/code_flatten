class ProjectProcessor {
    constructor() {
        this.gitIgnoreRules = [];
        this.ignoreDirs = [];
        this.ignoreExts = [];
        this.maxFileSize = 1024 * 1024; 
    }

    async loadConfig() {
        try {
            const response = await fetch('assets/ignore');
            if (response.ok) {
                const text = await response.text();
                const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                this.ignoreDirs = lines.filter(l => !l.startsWith('.')); 
                this.ignoreExts = lines.filter(l => l.startsWith('.'));
            }
        } catch (e) {
            console.warn("Failed to load ignore file, using defaults.");
        }
    }

    parseGitIgnore(content) {
        this.gitIgnoreRules = content.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(rule=>{
            const isDir=rule.endsWith('/');
            const clean=rule.replace(/\/$/,'');
            return{rule:clean,isDir}
        })
    }

    shouldIgnore(path) {
        path = path.replace(/\\/g,'/');
        const parts = path.split('/');
        const fileName = parts[parts.length-1];
        if (parts.some(p => this.ignoreDirs.includes(p))) return true;
        if (this.ignoreExts.some(ext => fileName.toLowerCase().endsWith(ext) || parts.includes(ext))) return true;
        if (this.gitIgnoreRules.length > 0) {
            for (const {rule, isDir} of this.gitIgnoreRules) {
                if (parts.includes(rule)) return true;
                if (rule.includes('/')) {
                    const normalizedRule = rule.startsWith('/') ? rule.slice(1) : rule;
                    if (path === normalizedRule || path.startsWith(normalizedRule+'/') || path.includes('/'+normalizedRule+'/')) return true;
                }
                if (fileName === rule) return true;
                if (rule.startsWith('*') && fileName.endsWith(rule.slice(1))) return true;
            }
        }
        return false;
    }

    estimateTokens(text) {
        const chinese = (text.match(/[\u4e00-\u9fa5]/g)||[]).length;
        const other = text.length - chinese;
        return Math.ceil(chinese*1.5 + other*0.25);
    }

    generateTree(paths) {
        let tree = {};
        paths.forEach(path => { path.replace(/\\/g,'/').split('/').reduce((r,k) => r[k]=r[k]||{}, tree) });
        const print = (node, prefix="") => {
            let keys = Object.keys(node);
            return keys.map((key,i) => {
                let last = i === keys.length-1;
                let str = prefix + (last ? "└── " : "├── ") + key + "\n";
                if(Object.keys(node[key]).length) str += print(node[key], prefix + (last ? "    " : "│   "));
                return str;
            }).join('');
        };
        return Object.keys(tree).length ? (paths.length>1 ? "Root/\n" : "") + print(tree) : "";
    }

    async restoreFilesFromText(content, originalName="forge_restored") {
        const markerRegex = /(?:^|\r?\n)[=-]{3,}\s*File:\s*(.*?)\s*[=-]{3,}(?:\r?\n|$)/g;
        const zip = new JSZip();
        let fileCount = 0;
        let match;
        let matches = [];
        while ((match = markerRegex.exec(content)) !== null) {
            matches.push({path: match[1].trim(), startIndex: match.index, endIndex: match.index + match[0].length});
        }
        if (matches.length === 0) throw new Error("No file markers found (=== File: ... ===)");
        
        let extractedName = originalName;
        if (matches.length > 0) {
            const firstPath = matches[0].path.replace(/\\/g,'/');
            const parts = firstPath.split('/');
            if (parts.length > 1) extractedName = parts[0];
        }

        for (let i = 0; i < matches.length; i++) {
            const current = matches[i];
            const next = matches[i+1];
            const contentStart = current.endIndex;
            const contentEnd = next ? next.startIndex : content.length;
            let rawContent = content.substring(contentStart, contentEnd);
            let cleanPath = current.path.replace(/\\/g,'/').replace(/^(\.\/|\/)+/,'').replace(/(^|[\/\\])\.\.([\/\\]|$)/g,'$1$2');
            if (!cleanPath || cleanPath.endsWith('/')) continue;
            rawContent = rawContent.replace(/^\s*[\r\n]/,'').replace(/[\r\n]\s*$/,'');
            zip.file(cleanPath, rawContent);
            fileCount++;
        }
        if (fileCount > 0) {
            const blob = await zip.generateAsync({type:"blob"});
            return {blob, fileCount, extractedName};
        } else throw new Error("No valid files extracted.");
    }
}

function generateTimeStr(date){return date.getFullYear()+String(date.getMonth()+1).padStart(2,'0')+String(date.getDate()).padStart(2,'0')+"_"+String(date.getHours()).padStart(2,'0')+String(date.getMinutes()).padStart(2,'0')}
async function scanFiles(entries,processorInstance,encoding='UTF-8',pathPrefix=""){let results=[];for(const entry of entries){if(!entry)continue;const fullPath=pathPrefix?`${pathPrefix}/${entry.name}`:entry.name;if(entry.isFile){if(processorInstance.shouldIgnore(fullPath))continue;try{const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));const processed=await processSingleFile(file,fullPath,processorInstance,encoding);if(processed)results.push(processed)}catch(err){console.warn(`Error reading ${fullPath}`,err)}}else if(entry.isDirectory){if(processorInstance.shouldIgnore(fullPath))continue;const dirReader=entry.createReader();const childEntries=await new Promise((resolve,reject)=>{dirReader.readEntries(resolve,reject)});const childResults=await scanFiles(childEntries,processorInstance,encoding,fullPath);results=results.concat(childResults)}}return results}
async function processSingleFile(file,path,processorInstance,encoding='UTF-8'){if(file.size>processorInstance.maxFileSize){return{file,path,content:`// [WARN] File skipped: size (${(file.size/1024/1024).toFixed(2)}MB) exceeds limit.\n`,selected:true}}if(file.name==='.gitignore'){const text=await readFileAsText(file,encoding);processorInstance.parseGitIgnore(text);return null}try{const text=await readFileAsText(file,encoding);return{file,path,content:text,selected:true}}catch(err){console.warn(`Skipped binary or error: ${path}`);return null}}
function readFileAsText(file,encoding='UTF-8'){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=(e)=>resolve(e.target.result);reader.onerror=reject;reader.readAsText(file,encoding)})}

const PROCESSOR = new ProjectProcessor();
const STATE = { globalFiles: [], finalOutput: "", currentProjectName: "forge_context" };

document.addEventListener('DOMContentLoaded', async () => {
    await PROCESSOR.loadConfig();
    setupDragAndDrop(); setupNativeInputs(); loadPromptTemplate();
});

function setupDragAndDrop() {
    const packZone = document.getElementById('packZone');
    const inflateZone = document.getElementById('inflateZone');
    [packZone, inflateZone].forEach(zone => {
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-active'); });
        zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.classList.remove('drag-active'); });
    });
    packZone.addEventListener('drop', async (e) => {
        e.preventDefault(); packZone.classList.remove('drag-active');
        const items = e.dataTransfer.items;
        if (!items) return;
        showLoading(true); resetResultsArea();
        const minWait = new Promise(resolve => setTimeout(resolve, 500));
        try {
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                try {
                    if (typeof items[i].webkitGetAsEntry === 'function') {
                        const ent = items[i].webkitGetAsEntry();
                        if(ent) entries.push(ent);
                    }
                } catch(e) {}
            }
            if (entries.length > 0) STATE.currentProjectName = entries[0].name;
            STATE.globalFiles = [];
            const encoding = getEncodingFromDOM();
            const scannedFiles = await scanFiles(entries, PROCESSOR, encoding);
            await minWait;
            STATE.globalFiles = scannedFiles;
            if (STATE.globalFiles.length === 0) showToast('未找到有效文件', 'error');
            else { renderFileTree(); updateCapsuleStats(); }
        } catch (error) { console.error(error); showToast('处理出错: ' + error.message, 'error');
        } finally { showLoading(false); }
    });
    inflateZone.addEventListener('drop', async (e) => {
        e.preventDefault(); inflateZone.classList.remove('drag-active');
        const files = e.dataTransfer.files;
        if (files.length > 0) handleInflateUpload(files[0]);
    });
}

function setupNativeInputs() {
    document.getElementById('fileInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        showLoading(true); resetResultsArea();
        const minWait = new Promise(r => setTimeout(r, 500));
        STATE.globalFiles = [];
        const encoding = getEncodingFromDOM();
        if (files.length > 0) { const firstPath = files[0].webkitRelativePath; if (firstPath) STATE.currentProjectName = firstPath.split('/')[0]; }
        const gitIgnoreFile = files.find(f => f.name === '.gitignore' && (f.webkitRelativePath.split('/').length === 2));
        if (gitIgnoreFile) { const text = await readFileAsText(gitIgnoreFile, encoding); PROCESSOR.parseGitIgnore(text); }
        const processedList = [];
        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            if (PROCESSOR.shouldIgnore(path)) continue;
            const res = await processSingleFile(file, path, PROCESSOR, encoding);
            if (res) processedList.push(res);
        }
        await minWait;
        STATE.globalFiles = processedList;
        if (STATE.globalFiles.length === 0) { showToast('未找到有效代码文件 (全部被过滤)', 'error'); showLoading(false); return; }
        renderFileTree(); updateCapsuleStats();
        showLoading(false);
    });
    document.getElementById('extraFileInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        const encoding = getEncodingFromDOM();
        let addedCount = 0;
        for (const file of files) {
            const path = "Extra_Files/" + file.name;
            const existIndex = STATE.globalFiles.findIndex(f => f.path === path);
            if (existIndex > -1) STATE.globalFiles.splice(existIndex, 1);
            try {
                const res = await processSingleFile(file, path, PROCESSOR, encoding);
                if (res) { STATE.globalFiles.push(res); addedCount++; }
            } catch (err) {}
        }
        if (addedCount > 0) {
            renderFileTree(); updateCapsuleStats(); showToast(`已追加 ${addedCount} 个文件`, "success");
            if (STATE.currentProjectName === "forge_context" && files.length > 0) STATE.currentProjectName = "Mixed_Files";
            resetResultsArea();
        }
        e.target.value = '';
    });
    document.getElementById('txtInput').addEventListener('change', (e) => {
        const files = e.target.files; if (files.length > 0) handleInflateUpload(files[0]); e.target.value = '';
    });
}

async function loadPromptTemplate() {
    const promptElement = document.getElementById('promptText');
    if (!promptElement) return;
    try {
        const response = await fetch('../assets/prompt_templates/full.txt');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        promptElement.innerText = await response.text(); promptElement.style.color = '';
    } catch (error) { promptElement.innerText = "// ⚠️ 提示词加载失败，请检查文件路径或网络连接。"; promptElement.style.color = '#ef4444'; }
}

function doSmelt() {
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    if (activeFiles.length === 0) { showToast('请至少选择一个文件', 'error'); return; }
    showLoading(true);
    const minWait = new Promise(r => setTimeout(r, 500));
    setTimeout(async () => {
        const paths = activeFiles.map(f => f.path);
        let result = "Project Structure:\n" + PROCESSOR.generateTree(paths) + "\n\n================================================\n\n";
        activeFiles.forEach(f => {
            const cleanPath = f.path.replace(/\\/g, '/');
            result += `=== File: ${cleanPath} ===\n${f.content}\n\n`;
        });
        STATE.finalOutput = result;
        const previewArea = document.getElementById('previewArea');
        const previewText = STATE.finalOutput.length > 3000 ? STATE.finalOutput.substring(0, 3000) + "\n... (内容过长，仅显示预览)" : STATE.finalOutput;
        previewArea.innerText = previewText;
        await minWait;
        showToast(`已成功熔炼 ${activeFiles.length} 个文件`, 'success'); showLoading(false);
    }, 50);
}

async function remoldToZip() {
    const content = document.getElementById('pasteArea').value;
    if (!content.trim()) { showToast("内容为空，请先粘贴代码", "error"); return; }
    const btn = document.querySelector('#remoldSection .large-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="status-icon">⏳</span> 正在重塑...';
    try {
        const { blob, fileCount, extractedName } = await PROCESSOR.restoreFilesFromText(content);
        const timeStr = generateTimeStr(new Date());
        saveAs(blob, `${extractedName}_${timeStr}.zip`);
        showToast(`成功重塑 ${fileCount} 个文件`, "success");
    } catch (e) { showToast("Zip 生成失败: " + e.message, "error"); } finally { btn.innerHTML = originalText; }
}

function getEncodingFromDOM() { return document.getElementById('encodingSelect') ? document.getElementById('encodingSelect').value : 'UTF-8'; }

function renderFileTree() {
    const container = document.getElementById('fileTree');
    container.innerHTML = '';
    const treeRoot = {};
    STATE.globalFiles.forEach((fileItem, index) => {
        const parts = fileItem.path.split('/');
        let currentLevel = treeRoot;
        parts.forEach((part, i) => {
            if (i === parts.length - 1) currentLevel[part] = { _type: 'file', _index: index, _name: part };
            else {
                if (!currentLevel[part]) currentLevel[part] = { _type: 'folder', _name: part, _children: {} };
                currentLevel = currentLevel[part]._children;
            }
        });
    });
    Object.keys(treeRoot).forEach(key => container.appendChild(createTreeNode(treeRoot[key])));
}

function createTreeNode(node) {
    if (node._type === 'file') {
        const fileData = STATE.globalFiles[node._index];
        const div = document.createElement('div');
        div.className = `tree-leaf ${!fileData.selected ? 'deselected' : ''}`;
        div.innerHTML = `<span class="leaf-icon">📄</span><span class="leaf-name">${node._name}</span>${!fileData.selected ? '' : '<span class="status-dot"></span>'}`;
        div.onclick = () => toggleFileSelection(node._index, div);
        return div;
    } else {
        const details = document.createElement('details');
        details.className = 'tree-branch'; details.open = true;
        const summary = document.createElement('summary');
        summary.className = 'tree-summary';
        summary.innerHTML = `<span class="folder-icon">📂</span> ${node._name}`;
        details.appendChild(summary);
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'branch-content';
        Object.keys(node._children).sort((a, b) => {
            const nodeA = node._children[a], nodeB = node._children[b];
            if (nodeA._type !== nodeB._type) return nodeA._type === 'folder' ? -1 : 1;
            return a.localeCompare(b);
        }).forEach(key => childrenContainer.appendChild(createTreeNode(node._children[key])));
        details.appendChild(childrenContainer);
        return details;
    }
}

function toggleFileSelection(index, domElement) {
    STATE.globalFiles[index].selected = !STATE.globalFiles[index].selected;
    if (STATE.globalFiles[index].selected) {
        domElement.classList.remove('deselected');
        if(domElement.querySelector('.status-dot')) domElement.querySelector('.status-dot').remove();
        domElement.insertAdjacentHTML('beforeend', '<span class="status-dot"></span>');
    } else {
        domElement.classList.add('deselected');
        if(domElement.querySelector('.status-dot')) domElement.querySelector('.status-dot').remove();
    }
    updateCapsuleStats(); resetResultsArea();
}

function toggleAllFiles() {
    const hasUnchecked = STATE.globalFiles.some(f => !f.selected);
    STATE.globalFiles.forEach(f => f.selected = hasUnchecked);
    renderFileTree(); updateCapsuleStats(); resetResultsArea();
}

function clearFileTree() {
    STATE.globalFiles = []; renderFileTree(); updateCapsuleStats(); resetResultsArea(); showToast("文件列表已清空");
}

function updateCapsuleStats() {
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    document.getElementById('fileCountVal').innerText = activeFiles.length;
    let totalChars = 0;
    activeFiles.forEach(f => totalChars += f.content.length);
    document.getElementById('tokenVal').innerText = `~${PROCESSOR.estimateTokens(activeFiles.map(f => f.content).join('')).toLocaleString()}`;
}

async function copyTreeOnly() {
    if (STATE.globalFiles.length === 0) { showToast("请先上传项目", "error"); return; }
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    if (activeFiles.length === 0) { showToast("请至少选择一个文件", "error"); return; }
    try {
        await navigator.clipboard.writeText("Project Structure:\n" + PROCESSOR.generateTree(activeFiles.map(f => f.path)));
        showToast("已仅复制目录树", "success");
    } catch (e) { showToast("复制失败", "error"); }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    if(tab === 'smelt') { document.querySelectorAll('.tab-btn')[0].classList.add('active'); document.getElementById('smeltSection').classList.add('active'); }
    else { document.querySelectorAll('.tab-btn')[1].classList.add('active'); document.getElementById('remoldSection').classList.add('active'); }
}

function triggerAddExtra() { document.getElementById('extraFileInput').click(); }

async function handleInflateUpload(file) {
    if (file) {
        try {
            const text = await readFileAsText(file, getEncodingFromDOM());
            document.getElementById('pasteArea').value = text;
            showToast(`已加载文件: ${file.name}`, "success");
        } catch (e) { showToast("文件读取失败", "error"); }
    }
}

function clearPasteArea() { document.getElementById('pasteArea').value = ''; showToast('内容已清空'); }
function resetResultsArea() { STATE.finalOutput = ""; document.getElementById('previewArea').innerText = ""; }

function downloadFile() {
    if (!STATE.finalOutput) { showToast("没有可下载的内容", "error"); return; }
    const blob = new Blob([STATE.finalOutput], { type: 'text/plain;charset=utf-8' });
    const fileName = `${STATE.currentProjectName}_${generateTimeStr(new Date())}.txt`;
    saveAs(blob, fileName);
    showToast(`下载开始: ${fileName}`, "success");
}

async function copyToClipboard() {
    if (!STATE.finalOutput) { showToast("没有可复制的内容", "error"); return; }
    const btn = document.querySelector('#previewContainer .tool-btn');
    const originalText = btn.innerHTML; btn.innerHTML = '<span class="btn-icon">⏳</span>复制中...';
    try { await navigator.clipboard.writeText(STATE.finalOutput); showToast("已复制到剪贴板！", "success"); }
    catch (e) { showToast('复制失败', 'error'); } finally { btn.innerHTML = originalText; }
}

function copyPromptHint() {
    const promptElement = document.getElementById('promptText');
    if (!promptElement) return;
    navigator.clipboard.writeText(promptElement.innerText);
    showToast("Prompt 已复制！", "success");
}