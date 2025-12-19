const RefineModule = {
    state: { baseText: "", baseFileName: "", patchedText: "", changes: [], analysisDone: false },

    init: function() {
        this.setupListeners();
        this.loadRefinePromptTemplate();
    },

    setupListeners: function() {
        const input = document.getElementById('refineBaseInput');
        if(input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) this.loadBaseFile(e.target.files[0]); });
        
        const zone = document.getElementById('baseZone');
        if (zone) {
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-active'); });
            zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.classList.remove('drag-active'); });
            zone.addEventListener('drop', (e) => {
                e.preventDefault(); zone.classList.remove('drag-active');
                if (e.dataTransfer.files.length > 0) this.loadBaseFile(e.dataTransfer.files[0]);
            });
        }
    },

    loadRefinePromptTemplate: async function() {
        const promptEl = document.getElementById('refinePromptText');
        if (!promptEl) return;
        try {
             // 尝试加载新的 Prompt 模板，如果没有则显示默认文本
             const response = await fetch('../assets/prompt_templates/patch.txt');
             if (response.ok) { promptEl.innerText = await response.text(); promptEl.style.color = ''; } 
             else throw new Error("File not found");
        } catch(e) {
            // 这里硬编码推荐的 Prompt，以防文件加载失败
            promptEl.innerText = `You are a Code Refactoring Engine.\nOutput patches in this format:\n\n=== File: path/to/file.ext ===\n<<<<<< SEARCH\n[Original Code Block to Replace]\n======\n[New Code Block]\n>>>>>> REPLACE\n\nRules:\n1. The SEARCH block must contain the EXACT original code lines (ignoring whitespace differences).\n2. Do not use ellipses (...) in the SEARCH block.`;
            promptEl.style.color = 'var(--text-secondary)';
        }
    },

    loadBaseFile: async function(file) {
        try {
            const rawText = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=(e)=>resolve(e.target.result);reader.onerror=reject;reader.readAsText(file)});
            // 统一换行符
            const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            this.state.baseText = text; 
            this.state.baseFileName = file.name.replace(/\.(txt|md|js|html|css)$/i, '');
            this.state.analysisDone = false; 
            this.state.patchedText = "";

            const mainText = document.getElementById('baseMainText');
            const subText = document.getElementById('baseSubText');
            const zone = document.getElementById('baseZone');
            
            if(mainText && subText && zone) {
                mainText.innerText = file.name;
                subText.innerText = `${(file.size/1024).toFixed(1)} KB - Ready`; 
                zone.classList.add('has-file');
            }
            document.getElementById('diffViewer').innerHTML = '<div class="empty-tree-msg">File loaded. Paste the AI patch to analyze.</div>';
            showToast("Base file loaded", "success");
        } catch (e) { showToast("Read failed", "error"); console.error(e); }
    },

    clearPatch: function() { document.getElementById('patchInput').value = ''; },
    
    clearDiff: function() {
        document.getElementById('diffViewer').innerHTML = '<div class="empty-tree-msg">Waiting for analysis...</div>';
        this.state.analysisDone = false;
        this.state.patchedText = "";
    },

    analyzeOnly: function() {
        if (!this.state.baseText) { showToast("Load base file first", "error"); return; }
        
        const patchRaw = document.getElementById('patchInput').value;
        if (!patchRaw.trim()) { showToast("Patch input is empty", "error"); return; }

        const diffContainer = document.getElementById('diffViewer');
        diffContainer.innerHTML = '<div class="loading-spinner" style="padding:20px;text-align:center;">Analyzing Context...</div>';
        
        this.state.patchedText = "";
        this.state.analysisDone = false;

        setTimeout(() => {
            try {
                const patches = this.parsePatches(patchRaw);
                if (patches.length === 0) throw new Error("No valid SEARCH/REPLACE blocks found.");
                
                const result = this.applyPatchesFuzzy(this.state.baseText, patches);
                
                this.renderDiffView(patches, result.logs);
                this.state.patchedText = result.newText; 
                this.state.analysisDone = true;

                const successCount = result.successCount;
                if(successCount > 0) showToast(`Analysis Done: ${successCount} blocks to change`, "success");
                else showToast("Analysis Done: No matches found", "warning");

            } catch (e) {
                console.error(e); 
                diffContainer.innerHTML = `<div style="padding:20px; color:#ef4444;">❌ Parse Error: ${e.message}</div>`; 
                showToast("Parse Failed", "error");
            }
        }, 100);
    },

    // 解析器：支持旧的 START/END 格式（兼容）和新的 SEARCH/REPLACE 格式
    parsePatches: function(rawText) {
        const fileBlockRegex = /(?:^|\n)=== File:\s*(.*?)\s*===/g;
        let match;
        const fileBlocks = [];
        
        // 1. 先按文件切分
        while ((match = fileBlockRegex.exec(rawText)) !== null) {
            fileBlocks.push({ path: match[1].trim(), startIndex: match.index, fullMatch: match[0] });
        }
        
        const patches = [];
        
        fileBlocks.forEach((block, i) => {
            const nextBlock = fileBlocks[i+1];
            const contentEnd = nextBlock ? nextBlock.startIndex : rawText.length;
            const blockContent = rawText.substring(block.startIndex + block.fullMatch.length, contentEnd);
            
            // 正则：匹配 SEARCH (或 START) ... ====== ... REPLACE (或 END)
            // 捕获组 1: SEARCH 内容
            // 捕获组 2: REPLACE 内容
            const blockRegex = /<<<<<< (?:SEARCH|START)\s*([\s\S]*?)\s*======\s*([\s\S]*?)\s*>>>>>> (?:REPLACE|END)/g;
            
            let pMatch;
            while ((pMatch = blockRegex.exec(blockContent)) !== null) {
                patches.push({
                    file: block.path,
                    searchBlock: pMatch[1], // 即使有前后换行也没关系，后面会处理
                    replaceBlock: pMatch[2]
                });
            }
        });
        return patches;
    },

    // 核心算法：模糊匹配替换
    applyPatchesFuzzy: function(baseText, patches) {
        // 为了防止多次替换导致的索引偏移，我们采取策略：
        // 1. 每次替换前，基于当前最新的文本寻找匹配位置
        // 2. 如果因为前面的修改导致后面找不到，则标记失败
        
        let currentText = baseText;
        let successCount = 0;
        const logs = [];

        for (const patch of patches) {
            // 1. 尝试在当前文本中定位 searchBlock
            const match = this.locateBlockFuzzy(currentText, patch.searchBlock);
            
            if (match) {
                // 执行替换
                const before = currentText.substring(0, match.start);
                const after = currentText.substring(match.end);
                
                // 处理替换块（修剪首尾多余换行，保持整洁，但如果原意是换行则保留）
                // 简单起见，我们移除首尾的单个换行符，因为正则捕获通常包含它们
                let replacement = patch.replaceBlock;
                if(replacement.startsWith('\n')) replacement = replacement.substring(1);
                // if(replacement.endsWith('\n')) replacement = replacement.substring(0, replacement.length - 1); // 结尾换行通常保留较好

                currentText = before + replacement + after;
                
                successCount++;
                logs.push({ patch, status: 'success', info: `Match found at index ${match.start}` });
            } else {
                logs.push({ patch, status: 'fail', msg: `Could not find code block in source. (Check whitespace or context mismatch)` });
            }
        }

        return { newText: currentText, successCount, logs };
    },

    // 模糊定位器：忽略空白字符差异
    locateBlockFuzzy: function(fullText, searchBlock) {
        // 如果完全匹配成功，直接返回
        const exactIdx = fullText.indexOf(searchBlock);
        if (exactIdx !== -1) return { start: exactIdx, end: exactIdx + searchBlock.length };

        // 尝试“逐行去空格”匹配
        // 将全文拆分为行，并生成“指纹” (trim 后的内容)
        const textLines = fullText.split('\n');
        const searchLines = searchBlock.split('\n').map(l => l.trim()).filter(l => l.length > 0); // 过滤掉 Patch 中的纯空行，提高容错

        if (searchLines.length === 0) return null;

        // 生成源文件行的指纹列表
        // 注意：我们需要保留原始行号的映射，以便算出字符索引
        const textFingerprints = textLines.map(l => l.trim());

        // 滑动窗口搜索
        for (let i = 0; i <= textFingerprints.length - searchLines.length; i++) {
            let match = true;
            for (let j = 0; j < searchLines.length; j++) {
                // 如果指纹不匹配 (忽略空行差异逻辑可在此优化)
                // 这里采用简单策略：如果 Search Block 某行为空，则跳过？
                // 不，上面已经 filter 掉了 searchLines 的空行。
                // 所以我们需要在 textFingerprints 中跳过空行吗？
                // 更稳健的做法：计算非空行的序列匹配。
                
                if (textFingerprints[i + j] !== searchLines[j]) {
                    match = false;
                    break;
                }
            }

            if (match) {
                // 找到了！计算 start 和 end 的字符索引
                // Start: textLines[i] 的起始位置
                // End: textLines[i + searchLines.length - 1] 的结束位置
                
                let startIndex = 0;
                for(let k=0; k<i; k++) startIndex += textLines[k].length + 1; // +1 是换行符
                
                let endIndex = startIndex;
                for(let k=0; k<searchLines.length; k++) endIndex += textLines[i+k].length + 1;
                
                // 由于最后一行可能没有换行符，或者计算会导致多加一个，微调一下通常不影响替换，
                // 但为了精确，replacement 最好直接替换这几行。
                // 这里的 endIndex 指向的是匹配块之后的那个字符位置。
                
                // 有个小问题：如果源文件中间夹杂了空行，而 Search Block 没有，上面指纹匹配会失败。
                // 但这是合理的，如果行结构都变了，确实不该匹配。
                
                // 修正：上面的循环假设是连续行匹配。对于大多数 AI patch 是够用的。
                return { start: startIndex, end: endIndex - 1 }; // -1 回退最后一个换行符
            }
        }
        
        return null;
    },

    downloadResult: function() {
        if (!this.state.analysisDone || !this.state.patchedText) { showToast("Analyze first", "error"); return; }
        const blob = new Blob([this.state.patchedText], { type: 'text/plain;charset=utf-8' });
        const timeStr = new Date().toISOString().slice(0,19).replace(/[-T:]/g, "");
        const fileName = `${this.state.baseFileName}_refined_${timeStr}.txt`;
        saveAs(blob, fileName); 
        showToast("Downloading: " + fileName, "success");
    },
    
    copyRefinePrompt: async function() {
        const promptEl = document.getElementById('refinePromptText');
        if (promptEl) {
             try { await navigator.clipboard.writeText(promptEl.innerText); showToast("Prompt Copied", "success"); } 
             catch(e) { showToast("Copy failed", "error"); }
        }
    },

    renderDiffView: function(patches, logs) {
        const container = document.getElementById('diffViewer');
        container.innerHTML = '';
        if (patches.length === 0) { container.innerHTML = '<div class="empty-tree-msg">No patches found</div>'; return; }
        
        patches.forEach((patch, i) => {
            const log = logs[i]; 
            const isSuccess = log && log.status === 'success';
            const div = document.createElement('div'); div.className = 'diff-block';
            const statusIcon = isSuccess ? '✅' : '❌';
            const statusClass = isSuccess ? 'tag-mod' : 'tag-err';
            let statusText = isSuccess ? 'MATCHED' : 'FAILED';
            
            const escape = (str) => str ? str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
            
            div.innerHTML = `
                <div class="diff-header"><span>${statusIcon} ${patch.file}</span><span class="diff-stat-tag ${statusClass}">${statusText}</span></div>
                <div class="diff-content-grid">
                     <div class="diff-half diff-old">
                        <div class="diff-label">SEARCH BLOCK (From AI)</div>
                        ${!isSuccess ? `<div style="color:#ef4444;margin-bottom:8px;font-size:0.8rem;">Err: ${log.msg}</div>` : ''}
                        <pre class="diff-pre deleted">${escape(patch.searchBlock)}</pre>
                     </div>
                     <div class="diff-half diff-new">
                        <div class="diff-label">REPLACE BLOCK (New)</div>
                        <pre class="diff-pre added">${escape(patch.replaceBlock)}</pre>
                     </div>
                </div>`;
            container.appendChild(div);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => { RefineModule.init(); });