/**
 * View Layer (The Face)
 * Handles DOM manipulation, event listeners, UI feedback, and calling Core logic.
 */

// --- GLOBAL STATE ---
const PROCESSOR = new ProjectProcessor();

const STATE = {
    globalFiles: [],
    finalOutput: "",
    currentProjectName: "code_press_context",
    readmeLoaded: false
};

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
    setupDragAndDrop();
    // Native File Input Handler
    setupNativeInputs();
});

// --- UI INTERACTIONS & EVENT LISTENERS ---

function setupDragAndDrop() {
    const packZone = document.getElementById('packZone');
    const inflateZone = document.getElementById('inflateZone');

    [packZone, inflateZone].forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-active');
        });
        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-active');
        });
    });

    // Pack Zone Drop (Folder scanning)
    packZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        packZone.classList.remove('drag-active');
        
        const items = e.dataTransfer.items;
        if (!items) return;

        showLoading(true);
        resetResultsArea();
        
        const minWait = new Promise(resolve => setTimeout(resolve, 500));

        try {
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                try {
                    // Check capability first
                    if (typeof items[i].webkitGetAsEntry === 'function') {
                        const ent = items[i].webkitGetAsEntry();
                        if(ent) entries.push(ent);
                    } else if (items[i].kind === 'file') {
                        console.warn("webkitGetAsEntry not supported for item", i);
                    }
                } catch(e) { console.warn("Skipping item", e); }
            }

            if (entries.length > 0) {
                STATE.currentProjectName = entries[0].name;
            }

            STATE.globalFiles = [];
            const encoding = getEncodingFromDOM();
            // Call Core Logic
            const scannedFiles = await scanFiles(entries, PROCESSOR, encoding);
            
            await minWait;

            STATE.globalFiles = scannedFiles;
            if (STATE.globalFiles.length === 0) {
                showToast('未找到有效文件', 'error');
            } else {
                renderFileTree();
                updateCapsuleStats();
            }
        } catch (error) {
            console.error(error);
            showToast('处理出错: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });

    // Inflate Zone Drop (Txt file)
    inflateZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        inflateZone.classList.remove('drag-active');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleInflateUpload(files[0]);
        }
    });
}

function setupNativeInputs() {
    document.getElementById('fileInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
    
        showLoading(true);
        resetResultsArea(); 
        const minWait = new Promise(r => setTimeout(r, 500));
        STATE.globalFiles = [];
        const encoding = getEncodingFromDOM();
    
        if (files.length > 0) {
            const firstPath = files[0].webkitRelativePath;
            if (firstPath) STATE.currentProjectName = firstPath.split('/')[0];
        }
    
        // Check for .gitignore (Manual finding since Flat FileList)
        const gitIgnoreFile = files.find(f => f.name === '.gitignore' && (f.webkitRelativePath.split('/').length === 2));
        if (gitIgnoreFile) {
            const text = await readFileAsText(gitIgnoreFile, encoding);
            PROCESSOR.parseGitIgnore(text);
        }
    
        const processedList = [];
        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            if (PROCESSOR.shouldIgnore(path)) continue;
            // Call Core Logic
            const res = await processSingleFile(file, path, PROCESSOR, encoding);
            if (res) processedList.push(res);
        }
    
        await minWait;
        STATE.globalFiles = processedList;
    
        if (STATE.globalFiles.length === 0) {
            showToast('未找到有效代码文件 (全部被过滤)', 'error');
            showLoading(false);
            return;
        }
    
        renderFileTree();
        updateCapsuleStats(); 
        showLoading(false);
    });

    // Extra File Input
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
                // Call Core Logic
                const res = await processSingleFile(file, path, PROCESSOR, encoding);
                if (res) {
                    STATE.globalFiles.push(res);
                    addedCount++;
                }
            } catch (err) { console.warn(`Skipped: ${path}`); }
        }

        if (addedCount > 0) {
            renderFileTree();
            updateCapsuleStats();
            showToast(`已追加 ${addedCount} 个文件`, "success");
            if (STATE.currentProjectName === "code_press_context" && files.length > 0) {
                 STATE.currentProjectName = "Mixed_Files";
            }
            resetResultsArea();
        }
        e.target.value = '';
    });
}

// --- DOM ACTIONS ---

function doFlatten() {
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    if (activeFiles.length === 0) {
        showToast('请至少选择一个文件', 'error');
        return;
    }

    showLoading(true);
    const minWait = new Promise(r => setTimeout(r, 500));
    
    setTimeout(async () => {
        const paths = activeFiles.map(f => f.path);
        // Call Core Logic
        let result = "Project Structure:\n" + PROCESSOR.generateTree(paths) + "\n\n================================================\n\n";
        
        activeFiles.forEach(f => {
            const cleanPath = f.path.replace(/\\/g, '/');
            result += `=== File: ${cleanPath} ===\n${f.content}\n\n`;
        });
        
        STATE.finalOutput = result;
        
        const previewArea = document.getElementById('previewArea');
        const previewText = STATE.finalOutput.length > 3000 ?
            STATE.finalOutput.substring(0, 3000) + "\n... (内容过长，仅显示预览)" : STATE.finalOutput;
        
        previewArea.innerText = previewText;

        await minWait;
        showToast(`已成功压扁 ${activeFiles.length} 个文件`, 'success');
        showLoading(false);
    }, 50);
}

async function inflateToZip() {
    const content = document.getElementById('pasteArea').value;
    if (!content.trim()) { 
        showToast("内容为空，请先粘贴代码", "error"); 
        return;
    }

    const btn = document.querySelector('#inflateSection .large-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="status-icon">⏳</span> 正在熔铸...';

    try {
        // Call Core Logic to get the Blob
        const { blob, fileCount, extractedName } = await PROCESSOR.restoreFilesFromText(content);
        
        const timeStr = generateTimeStr(new Date());
        const zipFileName = `${extractedName}_${timeStr}.zip`;

        saveAs(blob, zipFileName);
        showToast(`成功还原 ${fileCount} 个文件`, "success");

    } catch (e) {
        console.error(e);
        showToast("Zip 生成失败: " + e.message, "error");
    } finally {
        btn.innerHTML = originalText;
    }
}

// --- VIEW HELPERS ---

function getEncodingFromDOM() {
    return document.getElementById('encodingSelect') ? document.getElementById('encodingSelect').value : 'UTF-8';
}

function renderFileTree() {
    const container = document.getElementById('fileTree');
    container.innerHTML = '';
    const treeRoot = {};
    STATE.globalFiles.forEach((fileItem, index) => {
        const parts = fileItem.path.split('/'); 
        let currentLevel = treeRoot;
        parts.forEach((part, i) => {
            if (i === parts.length - 1) {
                currentLevel[part] = { _type: 'file', _index: index, _name: part };
            } else {
                if (!currentLevel[part]) {
                    currentLevel[part] = { _type: 'folder', _name: part, _children: {} };
                }
                currentLevel = currentLevel[part]._children;
             }
        });
    });
    Object.keys(treeRoot).forEach(key => {
        const rootNode = treeRoot[key];
        const rootEl = createTreeNode(rootNode);
        container.appendChild(rootEl);
    });
}

function createTreeNode(node) {
    if (node._type === 'file') {
        const fileData = STATE.globalFiles[node._index];
        const div = document.createElement('div');
        div.className = `tree-leaf ${!fileData.selected ? 'deselected' : ''}`;
        div.innerHTML = `
            <span class="leaf-icon">📄</span>
            <span class="leaf-name">${node._name}</span>
            ${!fileData.selected ? '' : '<span class="status-dot"></span>'}
        `;
        div.onclick = () => toggleFileSelection(node._index, div);
        return div;
    } else {
        const details = document.createElement('details');
        details.className = 'tree-branch';
        details.open = true;
        const summary = document.createElement('summary');
        summary.className = 'tree-summary';
        summary.innerHTML = `<span class="folder-icon">📂</span> ${node._name}`;
        
        details.appendChild(summary);
        
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'branch-content';
        const childrenKeys = Object.keys(node._children).sort((a, b) => {
            const nodeA = node._children[a];
            const nodeB = node._children[b];
            if (nodeA._type !== nodeB._type) {
                return nodeA._type === 'folder' ? -1 : 1;
            }
            return a.localeCompare(b);
        });
        
        childrenKeys.forEach(key => {
            childrenContainer.appendChild(createTreeNode(node._children[key]));
        });
        details.appendChild(childrenContainer);
        return details;
    }
}

function toggleFileSelection(index, domElement) {
    STATE.globalFiles[index].selected = !STATE.globalFiles[index].selected;
    if (STATE.globalFiles[index].selected) {
        domElement.classList.remove('deselected');
        const dot = domElement.querySelector('.status-dot');
        if(dot) dot.remove();
        domElement.insertAdjacentHTML('beforeend', '<span class="status-dot"></span>');
    } else {
        domElement.classList.add('deselected');
        const dot = domElement.querySelector('.status-dot');
        if(dot) dot.remove();
    }
    updateCapsuleStats();
    resetResultsArea();
}

function toggleAllFiles() {
    const hasUnchecked = STATE.globalFiles.some(f => !f.selected);
    STATE.globalFiles.forEach(f => f.selected = hasUnchecked);
    renderFileTree();
    updateCapsuleStats();
    resetResultsArea();
}

function updateCapsuleStats() {
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    document.getElementById('fileCountVal').innerText = activeFiles.length;
    let totalChars = 0;
    activeFiles.forEach(f => totalChars += f.content.length);
    const tokenEst = PROCESSOR.estimateTokens(activeFiles.map(f => f.content).join(''));
    document.getElementById('tokenVal').innerText = `~${tokenEst.toLocaleString()}`;
}

async function copyTreeOnly() {
    if (STATE.globalFiles.length === 0) {
        showToast("请先上传项目", "error");
        return;
    }
    const activeFiles = STATE.globalFiles.filter(f => f.selected);
    if (activeFiles.length === 0) {
        showToast("请至少选择一个文件", "error");
        return;
    }
    const paths = activeFiles.map(f => f.path);
    const treeText = "Project Structure:\n" + PROCESSOR.generateTree(paths);
    try {
        await navigator.clipboard.writeText(treeText);
        showToast("已仅复制目录树", "success");
    } catch (e) {
        console.error(e);
        showToast("复制失败", "error");
    }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    
    const btns = document.querySelectorAll('.tab-btn');
    if(tab === 'pack') {
        btns[0].classList.add('active');
        document.getElementById('packSection').classList.add('active');
    } else {
        btns[1].classList.add('active');
        document.getElementById('inflateSection').classList.add('active');
    }
}

// --- UTILITIES & FEEDBACK ---

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
}

function showToast(msg, type = 'normal') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = type === 'success' ?
        `<span>✅</span> ${msg}` : (type === 'error' ? `<span>⚠️</span> ${msg}` : msg);
    
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-20px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

function triggerAddExtra() { 
    document.getElementById('extraFileInput').click();
}

async function toggleSidebar() {
    const body = document.body;
    const isOpen = body.classList.contains('sidebar-open');
    if (isOpen) {
        body.classList.remove('sidebar-open');
        document.getElementById('mainContainer').onclick = null;
    } else {
        body.classList.add('sidebar-open');
        setTimeout(() => {
            document.getElementById('mainContainer').onclick = toggleSidebar;
        }, 100);
        if (!STATE.readmeLoaded) {
            await fetchAndRenderReadme();
        }
    }
}

async function fetchAndRenderReadme() {
    const contentDiv = document.getElementById('readmeContent');
    try {
        const response = await fetch(APP_CONFIG.REPO_README_URL + '?t=' + Date.now());
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const markdownText = await response.text();
        if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            const rawHtml = marked.parse(markdownText);
            contentDiv.innerHTML = DOMPurify.sanitize(rawHtml);
            STATE.readmeLoaded = true;
        } else {
            contentDiv.innerHTML = "<p style='color:red'>Marked or DOMPurify not loaded.</p>";
        }
    } catch (error) {
        console.error("README Load Error:", error);
        contentDiv.innerHTML = `
            <div style="text-align:center; padding-top:50px; color:var(--text-secondary)">
                <p>⚠️ 无法加载 README</p>
                <button class="btn btn-secondary" onclick="fetchAndRenderReadme()" style="margin:20px auto">重试</button>
            </div>
        `;
    }
}

async function handleInflateUpload(file) {
    if (file) {
        try {
            const encoding = getEncodingFromDOM();
            const text = await readFileAsText(file, encoding);
            document.getElementById('pasteArea').value = text;
            showToast(`已加载文件: ${file.name}`, "success");
        } catch (e) {
            showToast("文件读取失败", "error");
        }
    }
}

function cleanEscapedText() {
    const area = document.getElementById('pasteArea');
    let text = area.value;
    if (!text) { showToast("请先粘贴内容", "error"); return; }
    
    if (text.trim().startsWith('"') && text.trim().endsWith('"')) { 
        text = text.trim().slice(1, -1);
    }
    text = text.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    area.value = text;
    showToast("格式已修复！", "success");
}

function clearPasteArea() {
    document.getElementById('pasteArea').value = '';
    showToast('内容已清空');
}

function resetResultsArea() {
    STATE.finalOutput = "";
    document.getElementById('previewArea').innerText = "";
}

function downloadFile() {
    if (!STATE.finalOutput) {
        showToast("没有可下载的内容", "error");
        return;
    }
    const blob = new Blob([STATE.finalOutput], { type: 'text/plain;charset=utf-8' });
    const timeStr = generateTimeStr(new Date());
    const fileName = `${STATE.currentProjectName}_${timeStr}.txt`;
    
    saveAs(blob, fileName);
    showToast(`下载开始: ${fileName}`, "success");
}

async function copyToClipboard() {
    if (!STATE.finalOutput) {
        showToast("没有可复制的内容", "error");
        return;
    }

    const btn = document.querySelector('#previewContainer .tool-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span>复制中...';

    await new Promise(r => setTimeout(r, 100));
    try {
        await navigator.clipboard.writeText(STATE.finalOutput);
        showToast("已复制到剪贴板！", "success");
    } catch (e) { 
        showToast('复制失败，请尝试下载文件', 'error'); 
        console.error(e);
    } finally {
        btn.innerHTML = originalText;
    }
}

function copyPromptHint() {
    const promptElement = document.getElementById('promptText');
    if (!promptElement) return;
    navigator.clipboard.writeText(promptElement.innerText);
    showToast("Prompt 已复制！", "success");
}