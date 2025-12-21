/* ==========================================================================
   Core Logic: Tree & Smelting
   ========================================================================== */
const Logic = {
    getActiveFiles: () => STATE.files.filter(f => !f.excluded),

    generateTreeText: () => {
        const tree = {};
        Logic.getActiveFiles().forEach(f => {
            f.path.split('/').reduce((r, k) => r[k] = r[k] || {}, tree);
        });
        const print = (node, prefix = "") => {
            const keys = Object.keys(node).sort();
            return keys.map((key, i) => {
                const last = i === keys.length - 1;
                const str = prefix + (last ? "└── " : "├── ") + key + "\n";
                const children = Object.keys(node[key]).length 
                    ? print(node[key], prefix + (last ? "    " : "│   ")) 
                    : "";
                return str + children;
            }).join('');
        };
        return `Project: ${STATE.projectName}\nRoot/\n${print(tree)}`;
    },

    renderInteractiveTree: () => {
        // [优化] 如果树结构已经存在且项目未变更，不再重建 DOM
        if (UI.areas.treeContainer && UI.areas.treeContainer.hasChildNodes() && !STATE.needsTreeRebuild) {
             Logic.syncTreeVisuals();
             return;
        }

        if (!UI.areas.treeContainer) return;
        UI.areas.treeContainer.innerHTML = ''; 

        const tree = {};
        STATE.files.forEach(f => {
            let current = tree;
            f.path.split('/').forEach((part, index, arr) => {
                if (!current[part]) current[part] = index === arr.length - 1 ? "__FILE__" : {};
                current = current[part];
            });
        });

        const buildDom = (node, container, prefix = "", fullPathPrefix = "") => {
            const keys = Object.keys(node).sort();
            keys.forEach((key, i) => {
                const isFile = node[key] === "__FILE__";
                const last = i === keys.length - 1;
                const currentFullPath = fullPathPrefix ? `${fullPathPrefix}/${key}` : key;
                const row = document.createElement('div');
                row.className = 'tree-node';
                
                // [优化] 添加 data-path 属性，方便后续快速定位 DOM
                if (isFile) {
                    row.dataset.path = currentFullPath;
                    row.classList.add('tree-node--file');
                    
                    // 绑定事件
                    row.onclick = (e) => {
                        e.stopPropagation();
                        Logic.toggleFile(currentFullPath);
                    };
                }

                const prefixSpan = document.createElement('span');
                prefixSpan.textContent = prefix + (last ? "└── " : "├── ");
                prefixSpan.style.opacity = "0.5";
                
                const nameSpan = document.createElement('span');
                nameSpan.className = `node-label ${isFile ? '' : 'tree-node--folder'}`;
                nameSpan.textContent = key;

                row.appendChild(prefixSpan);
                row.appendChild(nameSpan);
                container.appendChild(row);

                if (!isFile) {
                    buildDom(node[key], container, prefix + (last ? "    " : "│   "), currentFullPath);
                }
            });
        };

        const header = document.createElement('div');
        header.className = 'tree-node';
        header.innerHTML = `<span class="tree-node--folder">Project: ${STATE.projectName}</span>`;
        UI.areas.treeContainer.appendChild(header);
        
        buildDom(tree, UI.areas.treeContainer);
        
        // 渲染完 DOM 后，同步一次状态
        STATE.needsTreeRebuild = false;
        Logic.syncTreeVisuals();
    },

    // [新增] 轻量级状态同步，避免重绘 DOM
    syncTreeVisuals: () => {
        // 遍历所有文件节点
        const fileNodes = UI.areas.treeContainer.querySelectorAll('.tree-node--file');
        fileNodes.forEach(node => {
            const path = node.dataset.path;
            const fileObj = STATE.files.find(f => f.path === path);
            
            if (fileObj) {
                if (fileObj.excluded) {
                    node.classList.add('is-disabled');
                } else {
                    node.classList.remove('is-disabled');
                }
            }
        });
        Logic.updateStats(); // 顺便更新统计
    },

    toggleFile: (path) => {
        const file = STATE.files.find(f => f.path === path);
        if (file) {
            file.excluded = !file.excluded;
            
            // [优化] 只更新文本预览的内容 + 树的视觉样式，不重建树
            UI.areas.treeViewer.value = Logic.generateTreeText();
            Logic.syncTreeVisuals();
        }
    },

    updateStats: () => {
        const includedFiles = Logic.getActiveFiles();
        UI.stats.fileCount.innerText = includedFiles.length;
        const totalContent = includedFiles.map(f => f.content).join("");
        UI.stats.tokenCount.innerText = `~${Utils.estimateTokens(totalContent).toLocaleString()}`;
    },

    renderProjectState: () => {
        UI.areas.treeViewer.value = Logic.generateTreeText();
        Logic.renderInteractiveTree();
        Logic.updateStats();
    },

    mergeProjectFiles: () => {
        const includedFiles = Logic.getActiveFiles();
        if (includedFiles.length === 0) return Utils.showToast(UI_TEXT.toast.noMergeFiles, "error");
        
        const treeStr = Logic.generateTreeText();
        const contentStr = includedFiles.map(f => {
            const safeContent = f.content.replaceAll(MAGIC_TOKEN, ESCAPED_TOKEN);
            const lang = getLangFromExt(f.path);
            return `${MAGIC_TOKEN} ${f.path} ===\n\`\`\`${lang}\n${safeContent}\n\`\`\`\n`;
        }).join("\n");
        const finalOutput = `${UI_TEXT.prompt.header}${treeStr}\n================================================\n\n${contentStr}`;
        UI.areas.preview.value = finalOutput;
        
        // 优化：合并完成后平滑滚动到预览区顶部
        UI.areas.preview.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        Utils.showToast(UI_TEXT.toast.mergeSuccess(includedFiles.length));
    },

    generateRestorePackage: async () => {
        const content = UI.areas.restore.value || "";
        if (!content.trim()) return Utils.showToast(UI_TEXT.toast.restoreFail, "error");

        Utils.showToast("正在后台打包...", "info"); // 提示用户

        // 创建 Worker
        const worker = new Worker('js/worker-zip.js');

        // 发送数据
        worker.postMessage({
            content: content,
            config: {
                // 假设这两个常量定义在 config.js 或全局作用域，需要传给 worker
                MAGIC_TOKEN: typeof MAGIC_TOKEN !== 'undefined' ? MAGIC_TOKEN : 'AIchemy_Magic_Token',
                ESCAPED_TOKEN: typeof ESCAPED_TOKEN !== 'undefined' ? ESCAPED_TOKEN : 'AIchemy_Escaped_Token'
            }
        });

        // 监听结果
        worker.onmessage = (e) => {
            const { success, blob, count, error } = e.data;
            
            if (success) {
                saveAs(blob, `${STATE.projectName}_restore_${Utils.getTimestamp()}.zip`);
                Utils.showToast(UI_TEXT.toast.restoreSuccess(count));
            } else {
                if (error === 'no_tags') {
                    Utils.showToast(UI_TEXT.toast.restoreNoTag, "error");
                } else {
                    Utils.showToast("打包失败: " + error, "error");
                }
            }
            worker.terminate(); // 任务完成，销毁 worker
        };

        worker.onerror = (err) => {
            console.error(err);
            Utils.showToast("Worker 发生错误", "error");
            worker.terminate();
        };
    }
};
/* ==========================================================================
   Patch & Diff Engine (Enhanced Atomized Version)
   ========================================================================== */
const PatchLogic = {
    // 状态存储：Map<FilePath, { original: string, hunks: Array }>
    fileStates: new Map(),
    baselines: new Map(),
    dmp: new diff_match_patch(),

    registerBaseline: (filename, content) => {
        PatchLogic.baselines.set(filename, content);
    },

    parsePatchText: (text) => {
        // 允许 >>> 后面有空格或换行
        const fileRegex = /(?:^|\n)(?:\\+)?\\\=== File:\s*(.*?)\s*===\s*[\r\n]+<<<< SEARCH\s*([\s\S]*?)==== REPLACE\s*([\s\S]*?)>>>>/g;
        const patches = [];
        let match;
        while ((match = fileRegex.exec(text)) !== null) {
            patches.push({
                path: match[1].trim(),
                search: match[2],
                replace: match[3],
                // 生成唯一ID方便UI操作
                id: `hunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            });
        }
        return patches;
    },

    generateSplitHtml: (diffs) => {
        let oldHtml = "";
        let newHtml = "";
        diffs.forEach(([op, text]) => {
            const safeText = Utils.escapeHtml(text);
            if (op === 0) {
                oldHtml += safeText;
                newHtml += safeText;
            } else if (op === -1) {
                oldHtml += `<del>${safeText}</del>`;
            } else if (op === 1) {
                newHtml += `<ins>${safeText}</ins>`;
            }
        });
        return { oldHtml, newHtml };
    },

    /**
     * 核心预览逻辑：生成可交互的 DOM
     */
    // ... 在 PatchLogic 对象中 ...

    previewPatch: () => {
        const input = UI.areas.patch.value;
        if (!input.trim()) return Utils.showToast(UI_TEXT.toast.patchEmpty, "error");

        Utils.showToast("正在分析差异...", "info");
        UI.areas.diff.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">⏳ 计算中...</div>';

        // 准备文件数据 (将 Map 转为 Plain Object 传给 Worker)
        const filesData = {};
        
        // 1. 先放入 Baseline
        for (const [name, content] of PatchLogic.baselines) {
            filesData[name] = content;
        }
        // 2. 再放入当前项目文件 (优先匹配全路径，Worker 里会处理文件名匹配)
        STATE.files.forEach(f => {
            const p = f.path.trim().replace(/^\.\//, '');
            filesData[p] = f.content;
        });

        // 创建 Worker
        const worker = new Worker('js/worker-diff.js');

        worker.postMessage({
            patchInput: input,
            filesData: filesData
        });

        worker.onmessage = (e) => {
            const { success, results, error } = e.data;
            
            if (!success) {
                UI.areas.diff.innerHTML = "";
                Utils.showToast(error === 'invalid_patch' ? UI_TEXT.toast.patchInvalid : "Diff 计算错误", "error");
                worker.terminate();
                return;
            }

            // --- 渲染逻辑开始 (回到主线程) ---
            PatchLogic.fileStates.clear();
            UI.areas.diff.innerHTML = "";
            
            let successFileCount = 0;
            const containerFragment = document.createDocumentFragment();

            results.forEach(fileResult => {
                if (fileResult.error) {
                    PatchLogic._renderErrorBlock(containerFragment, fileResult.filePath, fileResult.error);
                    return;
                }

                // 还原 Hunk 状态对象
                const fileHunks = fileResult.hunks.map(h => ({
                    ...h,
                    active: h.isValid // 默认状态
                }));

                // 渲染文件容器
                const fileWrapper = document.createElement('div');
                fileWrapper.className = 'diff-file-wrapper';
                // 判断来源标签
                const isBaseline = PatchLogic.baselines.has(fileResult.filePath.split('/').pop());
                const sourceLabel = isBaseline ? UI_TEXT.templates.labelBaseline : "";

                fileWrapper.innerHTML = `
                    <div class="diff-file-info">
                        <span>📄 ${fileResult.filePath} <small style="opacity:0.6">${sourceLabel}</small></span>
                        <span style="font-size:0.8em; opacity:0.8">${fileHunks.length} changes detected</span>
                    </div>
                    <div class="diff-hunk-container" id="container-${fileResult.filePath.replace(/\W/g, '_')}"></div>
                `;

                const hunkContainer = fileWrapper.querySelector('.diff-hunk-container');
                let validHunkCount = 0;

                fileResult.hunks.forEach((h, index) => {
                    const isActive = h.isValid;
                    if (isActive) validHunkCount++;

                    // 构建样式
                    let headerStyle = "";
                    let statusHtml = "";
                    if (!h.isValid) {
                        headerStyle = "background: rgba(255, 50, 50, 0.1); color: #ffaaaa;";
                        statusHtml = `<span style="color:#ff6b6b; margin-right:10px;">⚠️ ${h.validityMsg}</span>`;
                    }

                    const card = document.createElement('div');
                    card.className = 'hunk-card';
                    if (!isActive) card.classList.add('rejected');
                    card.dataset.hunkId = h.id;

                    card.innerHTML = `
                        <div class="hunk-header" style="${headerStyle}">
                            <span>Change #${index + 1}</span>
                            <div class="hunk-actions">
                                ${statusHtml}
                                <button class="hunk-toggle ${isActive ? '' : 'is-rejected'}" 
                                        onclick="PatchLogic.toggleHunk('${fileResult.filePath}', '${h.id}', this)">
                                    ${isActive ? '✅ Applied' : '❌ Ignored'}
                                </button>
                            </div>
                        </div>
                        <div class="diff-split-view">
                            <div class="diff-pane pane-old">${h.diffHtml.oldHtml}</div>
                            <div class="diff-pane pane-new">${h.diffHtml.newHtml}</div>
                        </div>
                    `;
                    hunkContainer.appendChild(card);
                });

                // 存入 PatchLogic 状态供后续 "Apply" 使用
                PatchLogic.fileStates.set(fileResult.filePath, {
                    original: fileResult.originalContent,
                    hunks: fileHunks
                });

                if (validHunkCount > 0) successFileCount++;
                containerFragment.appendChild(fileWrapper);
            });

            UI.areas.diff.appendChild(containerFragment);

            if (successFileCount > 0) {
                Utils.showToast(UI_TEXT.toast.diffSuccess(results.length));
                UI.areas.diff.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                Utils.showToast("未发现有效变更", "error");
            }
            
            worker.terminate();
        };

        worker.onerror = (err) => {
            console.error(err);
            UI.areas.diff.innerHTML = '<div style="color:red; text-align:center;">Worker Error</div>';
            Utils.showToast("Diff Worker 发生错误", "error");
            worker.terminate();
        };
    },

    // 渲染错误块（无需状态管理）
    _renderErrorBlock: (container, path, msg) => {
        const div = document.createElement('div');
        div.className = 'diff-file-wrapper';
        div.innerHTML = `
            <div class="diff-file-info" style="color:#ff6b6b">📄 ${path} (Error)</div>
            <div class="diff-message">${msg}</div>
        `;
        container.appendChild(div);
    },

    /**
     * [新增] 切换单个变更块的状态
     */
    toggleHunk: (filePath, hunkId, btnElement) => {
        const fileState = PatchLogic.fileStates.get(filePath);
        if (!fileState) return;

        const hunk = fileState.hunks.find(h => h.id === hunkId);
        if (!hunk) return;

        // 切换状态
        hunk.active = !hunk.active;

        // 更新 UI
        const card = btnElement.closest('.hunk-card');
        if (hunk.active) {
            btnElement.textContent = "✅ Applied";
            btnElement.classList.remove('is-rejected');
            card.classList.remove('rejected');
        } else {
            btnElement.textContent = "❌ Ignored";
            btnElement.classList.add('is-rejected');
            card.classList.add('rejected');
        }
    },

    /**
     * [重写] 根据当前状态生成最终文件内容
     * 支持多文件处理，返回 Array<{path, content}>
     */
    _getPatchedFiles: () => {
        if (PatchLogic.fileStates.size === 0) {
            Utils.showToast("没有可应用的变更", "error");
            return [];
        }

        const results = [];

        for (const [path, state] of PatchLogic.fileStates) {
            let currentContent = state.original;
            
            // 过滤出激活的 Hunks
            const activeHunks = state.hunks.filter(h => h.active && h.isValid);
            
            // 简单处理：按顺序执行 replace
            // 注意：如果多个 Hunk 修改同一文件，且顺序不对，replace 可能会失败。
            // 假设 LLM 生成的 Patch 是有序的。
            let appliedCount = 0;
            
            for (const hunk of activeHunks) {
                // 使用 replace 替换一次
                // 这里的关键是：originalSearch 必须能在 currentContent 中找到
                // 因为是逐个应用，如果 Hunk A 修改了 Hunk B 的上下文，Hunk B 会失效。
                // 这是一个简化版的 Patch 应用逻辑。
                if (currentContent.includes(hunk.originalSearch)) {
                    currentContent = currentContent.replace(hunk.originalSearch, hunk.replace);
                    appliedCount++;
                } else {
                    console.warn(`[Patch] Hunk skipped for ${path}, context not found.`);
                }
            }
            
            if (appliedCount > 0) {
                results.push({ path, content: currentContent });
            }
        }
        
        return results;
    },

    applyAndDownload: () => {
        const patchedFiles = PatchLogic._getPatchedFiles();
        if (patchedFiles.length === 0) return;

        // 如果只有一个文件，直接下载文本
        if (patchedFiles.length === 1) {
            const f = patchedFiles[0];
            const blob = new Blob([f.content], { type: 'text/plain;charset=utf-8' });
            const newFileName = f.path.split('/').pop().replace(/(\.[\w\d]+)$/, '_patched$1');
            saveAs(blob, newFileName);
            Utils.showToast(`已下载: ${newFileName}`);
        } 
        // 如果有多个文件，打包下载 (需要 JSZip 支持，index.html 已引入)
        else {
            const zip = new JSZip();
            patchedFiles.forEach(f => {
                zip.file(f.path, f.content);
            });
            zip.generateAsync({type:"blob"}).then(function(content) {
                saveAs(content, `patched_project_${Utils.getTimestamp()}.zip`);
                Utils.showToast(`已打包下载 ${patchedFiles.length} 个文件`);
            });
        }
    },

    applyAndCopy: () => {
        const patchedFiles = PatchLogic._getPatchedFiles();
        if (patchedFiles.length === 0) return;

        // 仅复制第一个文件的内容，或者拼接
        // 这里逻辑视需求而定，通常复制是为了快速粘贴回 IDE
        // 如果是多文件，提示用户用下载
        if (patchedFiles.length > 1) {
            Utils.showToast("检测到多个文件变更，请使用'应用 & 下载'", "info");
        }
        
        // 无论如何复制第一个
        Utils.copyToClipboard(patchedFiles[0].content);
    }
};

/* ==========================================================================
   New Module: Requirement Architect Logic
   ========================================================================== */
const RequirementLogic = {
    // 1. 配置管理
    getLLMConfig: () => {
        const saved = localStorage.getItem('aichemy_llm_config');
        return saved ? JSON.parse(saved) : {
            baseUrl: "https://api.openai.com/v1", // 默认
            model: "gpt-4o",
            apiKey: ""
        };
    },
    
    saveLLMConfig: (config) => {
        localStorage.setItem('aichemy_llm_config', JSON.stringify(config));
    },

    _callAI: async (messages, responseFormat = 'text') => {
        const config = RequirementLogic.getLLMConfig();
        if (!config.apiKey) throw new Error("请先在设置中配置 API Key");

        const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: messages,
                temperature: 0.7,
                // 如果是 json 模式且模型支持，可以加 response_format 参数，这里保持通用
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "API Request Failed");
        }

        const data = await response.json();
        return data.choices[0].message.content;
    },

    fetchMockOptions: async (userInput) => {
        const systemPrompt = `
        You are a Senior Technical Architect.
        Analyze the user's project request and determine critical technical decisions.
        Output strictly valid JSON (Array of Option Groups) with NO Markdown.
        Schema: [{"id":"...","title":"...","type":"radio|checkbox","options":[...]}]
        Always include a "Visual Style" group.
        `;

        try {
            // 调用通用方法
            let content = await RequirementLogic._callAI([
                { role: "system", content: systemPrompt },
                { role: "user", content: `User Request: "${userInput}"` }
            ]);

            // 清洗数据
            content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            return JSON.parse(content);
        } catch (error) {
            console.error("LLM Call Failed:", error);
            Utils.showToast(`分析失败: ${error.message}`, "error");
            // 返回兜底数据
            return [{
                id: "error_fallback", title: "⚠️ 建议手动补充细节", type: "checkbox",
                options: ["由 AI 自由决定", "遵循最佳实践"]
            }];
        }
    },

    /**
     * 2. 渲染选项卡片
     * @param {Array} schema - 从 fetchMockOptions 获取的配置数组
     */
    renderOptions: (schema) => {
        const container = document.getElementById('container-req-options');
        
        // 清空容器并移除隐藏类
        container.innerHTML = '';
        container.classList.remove('hidden');

        // 遍历并生成选项组卡片
        schema.forEach(group => {
            const card = document.createElement('div');
            card.className = 'option-group-card';
            
            // 构建卡片内部 HTML
            let html = `<span class="option-group-title">${group.title}</span><div class="option-chips">`;
            
            group.options.forEach((opt, idx) => {
                // 生成唯一 ID
                const inputId = `opt-${group.id}-${idx}`;
                // Radio 需要 name 属性分组，Checkbox 则不需要
                const nameAttr = group.type === 'radio' ? `name="${group.id}"` : ''; 
                
                html += `
                    <input type="${group.type}" id="${inputId}" ${nameAttr} class="chip-input" value="${opt}" data-group="${group.id}">
                    <label for="${inputId}" class="chip-label">${opt}</label>
                `;
            });
            
            html += `</div>`;
            card.innerHTML = html;
            container.appendChild(card);
        });
    },

    /**
     * 3. 生成最终 Prompt 并处理 UI 自适应
     */
    generateFinalPrompt: async () => {
        const userCommand = document.getElementById('input-req-command').value.trim();
        if (!userCommand) return Utils.showToast("请先输入一些需求想法", "error");

        // 收集用户选中的标签
        const inputs = document.querySelectorAll('.chip-input:checked');
        let selectionsStr = "";
        inputs.forEach(input => {
            const groupTitle = input.dataset.group; // 注意：renderOptions 里要把 data-group 改存 title 更直观
            selectionsStr += `- ${groupTitle}: ${input.value}\n`;
        });

        const btn = document.getElementById('action-gen-prompt');
        const originalText = btn.innerText;
        btn.innerText = "生成中...";
        btn.disabled = true;

        // 定义 Meta-Prompt (教 AI 如何写 Prompt 的 Prompt)
        const systemPrompt = `
        You are an expert "Prompt Engineer" and Senior Technical Lead.
        Your goal is to write a highly detailed, structured, and professional coding prompt for another AI Developer.
        
        Based on the "User's Original Idea" and the "Technical Constraints/Choices":
        1. Expand the requirements into a clear implementation plan.
        2. Define the project structure, key features, and code quality standards.
        3. The output format must be Markdown, ready to be copied and pasted.
        4. Start directly with "# Project Requirement Specification".
        `;

        const userMessage = `
        [User's Original Idea]
        ${userCommand}

        [Technical Constraints/Choices]
        ${selectionsStr || "No specific constraints selected, decide based on best practices."}

        [Context]
        The user has an existing file structure (seen in the file tree). 
        Please instruct the AI developer to implement the features within this context.
        `;

        try {
            const finalPrompt = await RequirementLogic._callAI([
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ]);

            // 输出结果
            const outputArea = document.getElementById('output-architect-prompt');
            const resultContainer = document.getElementById('container-final-prompt');
            
            outputArea.value = finalPrompt;
            resultContainer.classList.remove('hidden');
            
            // 自动调整高度
            outputArea.style.height = 'auto';
            outputArea.style.height = (outputArea.scrollHeight + 2) + 'px';
            resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            Utils.showToast("Prompt 生成完毕", "success");

        } catch (error) {
            Utils.showToast(`生成失败: ${error.message}`, "error");
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }
};