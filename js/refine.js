const RefineModule = {
    state: { baseText: "", baseFileName: "", patchedText: "", changes: [], analysisDone: false },
    init: function() {
        this.setupListeners(); this.loadRefinePromptTemplate();
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
             const response = await fetch('../assets/prompt_templates/patch.txt');
             if (response.ok) { promptEl.innerText = await response.text(); promptEl.style.color = ''; } 
             else throw new Error("File not found");
        } catch(e) {
            promptEl.innerText = "You are a code refactoring agent. Return changes using this format:\n\n=== File: path/to/file.js ===\n<<<<<< SEARCH\nexact code line to find\n======\nnew code to replace it with\n>>>>>>";
            promptEl.style.color = '';
        }
    },
    loadBaseFile: async function(file) {
        try {
            const rawText = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=(e)=>resolve(e.target.result);reader.onerror=reject;reader.readAsText(file)});
            const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            this.state.baseText = text; this.state.baseFileName = file.name.replace(/\.(txt|md)$/i, '');
            this.state.analysisDone = false; this.state.patchedText = "";
            const mainText = document.getElementById('baseMainText');
            const subText = document.getElementById('baseSubText');
            const zone = document.getElementById('baseZone');
            if(mainText && subText && zone) {
                mainText.innerText = file.name;
                subText.innerText = `${(file.size/1024).toFixed(1)} KB - 已就绪`; zone.classList.add('has-file');
            }
            document.getElementById('diffViewer').innerHTML = '<div class="empty-tree-msg">文件已加载，请粘贴补丁并点击分析</div>';
            showToast("基准文本已加载 (自动标准化换行符)", "success");
        } catch (e) { showToast("文件读取失败", "error"); console.error(e); }
    },
    clearPatch: function() { document.getElementById('patchInput').value = ''; },
    clearDiff: function() {
        document.getElementById('diffViewer').innerHTML = '<div class="empty-tree-msg">等待分析...</div>';
        this.state.analysisDone = false;
        this.state.patchedText = "";
    },
    analyzeOnly: function() {
        if (!this.state.baseText) { showToast("请先加载基准文本 (Step 1)", "error"); return; }
        const patchRaw = document.getElementById('patchInput').value;
        if (!patchRaw.trim()) { showToast("补丁内容为空", "error"); return; }
        const diffContainer = document.getElementById('diffViewer');
        diffContainer.innerHTML = '<div class="loading-spinner" style="padding:20px;text-align:center;">正在分析差异...</div>';
        this.state.patchedText = "";
        this.state.analysisDone = false;
        setTimeout(() => {
            try {
                const patches = this.parsePatches(patchRaw);
                if (patches.length === 0) throw new Error("未识别到有效的 SEARCH/REPLACE 块。请检查格式。");
                const result = this.applyPatchesToBase(this.state.baseText, patches);
                this.renderDiffView(patches, result.logs);
                this.state.patchedText = result.newText; this.state.analysisDone = true;
                const successCount = result.successCount;
                if(successCount > 0) showToast(`分析完成: ${successCount} 个变更待应用`, "success");
                else showToast("分析完成: 没有成功匹配的补丁", "warning");
            } catch (e) {
                console.error(e); diffContainer.innerHTML = `<div style="padding:20px; color:#ef4444;">❌ 解析错误: ${e.message}</div>`; showToast("解析失败", "error");
            }
        }, 100);
    },
    // === 在 AIchemy/js/refine.js 中替换相关方法 ===

    parsePatches: function(rawText) {
        const fileBlockRegex = /(?:^|\n)=== File:\s*(.*?)\s*===/g;
        let match;
        const fileBlocks = [];
        while ((match = fileBlockRegex.exec(rawText)) !== null) {
            fileBlocks.push({ path: match[1].trim(), startIndex: match.index, fullMatch: match[0] });
        }
        
        const patches = [];
        fileBlocks.forEach((block, i) => {
            const nextBlock = fileBlocks[i+1];
            const contentEnd = nextBlock ? nextBlock.startIndex : rawText.length;
            const blockContent = rawText.substring(block.startIndex + block.fullMatch.length, contentEnd);
            
            // 新的正则逻辑：匹配 START, 内容, END
            // 注意：[\s\S]*? 非贪婪匹配中间的内容
            const anchorRegex = /<<<<<< START\s*([\s\S]*?)\s*======\s*([\s\S]*?)\s*======\s*>>>>>> END\s*([\s\S]*?)(?:$|\n)/g;
            
            let pMatch;
            while ((pMatch = anchorRegex.exec(blockContent)) !== null) {
                patches.push({
                    file: block.path,
                    startAnchor: pMatch[1].trim(), // 起始锚点行
                    replacement: pMatch[2],        // 新代码块 (不做 trim，保留缩进)
                    endAnchor: pMatch[3].trim()    // 结束锚点行
                });
            }
        });
        return patches;
    },

    applyPatchesToBase: function(baseText, patches) {
        // 统一换行符并拆分为行数组，方便处理
        let lines = baseText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        let successCount = 0;
        const logs = [];

        // 为了防止索引偏移，我们倒序应用补丁，或者每次操作后重新计算（这里简单起见，假设补丁是顺序无关或针对不同文件的，但在单文件多补丁时最好重新定位）
        // 更健壮的方法：先定位所有补丁的行号，验证无冲突后，再从下往上替换。
        
        // 分组处理：按文件分组，每个文件内部按行号倒序处理
        // 这里简化演示单次扫描逻辑，实际建议对 lines 数组进行操作
        
        for (const patch of patches) {
             // 1. 寻找 Start Anchor 的行号
            let startIndex = -1;
            let endIndex = -1;
            
            // 简单的模糊匹配：忽略首尾空格
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === patch.startAnchor) {
                    startIndex = i;
                    break; 
                }
            }

            if (startIndex === -1) {
                logs.push({ patch, status: 'fail', msg: `无法定位起始锚点: "${patch.startAnchor.substring(0, 30)}..."` });
                continue;
            }

            // 2. 寻找 End Anchor 的行号 (必须在 Start 之后)
            for (let i = startIndex; i < lines.length; i++) {
                if (lines[i].trim() === patch.endAnchor) {
                    endIndex = i;
                    break;
                }
            }

            if (endIndex === -1) {
                logs.push({ patch, status: 'fail', msg: `找到起始锚点，但无法在之后定位结束锚点: "${patch.endAnchor.substring(0, 30)}..."` });
                continue;
            }

            // 3. 执行替换
            // 注意：startIndex 和 endIndex 是闭区间 [start, end]，这部分都会被 replacement 替换
            // replacement 文本需要按换行符拆回数组
            const newLines = patch.replacement.replace(/^\n/, '').replace(/\n$/, '').split('\n');
            
            // 数组替换操作：删除从 startIndex 到 endIndex 的行，插入 newLines
            const deleteCount = endIndex - startIndex + 1;
            lines.splice(startIndex, deleteCount, ...newLines);
            
            successCount++;
            logs.push({ patch, status: 'success', info: `Replaced lines ${startIndex+1} to ${endIndex+1}` });
        }

        return { newText: lines.join('\n'), successCount, logs };
    },
    renderDiffView: function(patches, logs) {
        const container = document.getElementById('diffViewer');
        container.innerHTML = '';
        if (patches.length === 0) { container.innerHTML = '<div class="empty-tree-msg">No patches found</div>'; return; }
        patches.forEach((patch, i) => {
            const log = logs[i]; const isSuccess = log && log.status === 'success';
            const div = document.createElement('div'); div.className = 'diff-block';
            const statusIcon = isSuccess ? '✅' : '❌';
            const statusClass = isSuccess ? 'tag-mod' : 'tag-err';
            let statusText = isSuccess ? 'MODIFIED' : 'FAILED';
            if (log.warning) statusText += ' (Warn)';
            const escape = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            div.innerHTML = `
                <div class="diff-header"><span>${statusIcon} ${patch.file}</span><span class="diff-stat-tag ${statusClass}">${statusText}</span></div>
                <div class="diff-content-grid">
                     <div class="diff-half diff-old"><div class="diff-label">OLD (Search)</div>${!isSuccess ? `<div style="color:#ef4444;margin-bottom:8px;">Err: ${log.msg}</div>` : ''}<pre class="diff-pre deleted">${escape(patch.search.trim())}</pre></div>
                     <div class="diff-half diff-new"><div class="diff-label">NEW (Replace)</div><pre class="diff-pre added">${escape(patch.replace.trim())}</pre></div>
                </div>`;
            container.appendChild(div);
        });
    },
    downloadResult: function() {
        if (!this.state.analysisDone || !this.state.patchedText) { showToast("请先点击 '分析' 生成结果", "error"); return; }
        const blob = new Blob([this.state.patchedText], { type: 'text/plain;charset=utf-8' });
        const timeStr = new Date().toISOString().slice(0,19).replace(/[-T:]/g, "");
        const fileName = `${this.state.baseFileName}_refined_${timeStr}.txt`;
        saveAs(blob, fileName); showToast("开始下载: " + fileName, "success");
    },
    copyRefinePrompt: async function() {
        const promptEl = document.getElementById('refinePromptText');
        if (promptEl) {
             try { await navigator.clipboard.writeText(promptEl.innerText); showToast("Refine Prompt 已复制", "success"); } 
             catch(e) { showToast("复制失败", "error"); }
        }
    }
};
document.addEventListener('DOMContentLoaded', () => { RefineModule.init(); });