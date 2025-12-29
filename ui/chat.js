import { PatchManager } from './patch.js';
import { LLMEngine } from '../lib/llm-engine.js'; // Import LLMEngine

export const ChatManager = {
    dom: {},
    inputFiles: [],

    init() {
        this.cacheDOM();
        this.bindFileUpload();
        this.bindTags();
        this.bindSend();
        this.bindAutoResize();
    },

    cacheDOM() {
        this.dom = {
            inputWrapper: document.getElementById('input-wrapper'),
            outputArea: document.getElementById('output-area'),
            mainInput: document.getElementById('main-input'),
            tagContainer: document.getElementById('tag-container'),
            filePreviewArea: document.getElementById('input-files-area'),
            btnSend: document.getElementById('send-btn'),
            btnInputUpload: document.getElementById('btn-input-upload'),
            chipBtns: document.querySelectorAll('.chip')
        };
    },

    bindFileUpload() {
        if (this.dom.btnInputUpload) {
            const dummyInput = document.createElement('input');
            dummyInput.type = 'file'; 
            dummyInput.multiple = true;
            dummyInput.onchange = (e) => {
                Array.from(e.target.files).forEach(file => this.addFileCard(file));
                dummyInput.value = ''; 
                this.dom.mainInput.focus();
            };
            this.dom.btnInputUpload.addEventListener('click', () => dummyInput.click());
        }
    },

    bindTags() {
        this.dom.chipBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.getAttribute('data-type');
                this.dom.tagContainer.innerHTML = ''; 
                
                const tag = document.createElement('div');
                tag.className = 'input-tag';
                tag.innerHTML = `<span>${type}</span><span class="material-symbols-outlined remove-tag">close</span>`;
                tag.addEventListener('click', () => tag.remove());
                
                this.dom.tagContainer.appendChild(tag);
                this.dom.mainInput.focus();
            });
        });
    },

    bindSend() {
        this.dom.btnSend.addEventListener('click', () => this.handleSend());
        this.dom.mainInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); 
                this.handleSend();
            }
        });
    },

    bindAutoResize() {
        this.dom.mainInput.addEventListener('input', (e) => {
            const el = e.target;
            el.style.height = 'auto'; 
            const newHeight = Math.min(el.scrollHeight, 250); 
            el.style.height = newHeight + 'px';
            el.style.overflowY = el.scrollHeight > 250 ? 'auto' : 'hidden';
        });
    },

    addFileCard(file) {
        this.inputFiles.push(file);
        this.dom.filePreviewArea.classList.remove('hidden');
        
        const ext = file.name.split('.').pop() || 'FILE';
        const card = document.createElement('div');
        card.className = 'file-card';
        card.innerHTML = `
            <div class="file-name">${file.name}</div>
            <div class="file-type">${ext}</div>
        `;
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            this.inputFiles = this.inputFiles.filter(f => f !== file);
            card.remove();
            if (this.dom.filePreviewArea.children.length === 0) this.dom.filePreviewArea.classList.add('hidden');
        });
        this.dom.filePreviewArea.appendChild(card);
    },

    async handleSend() {
        const rawInputText = this.dom.mainInput.value.trim();
        const attachedFiles = [...this.inputFiles];
        let fullContextText = rawInputText;

        if (!rawInputText && attachedFiles.length === 0) return;

        // 1. Process File Content
        if (attachedFiles.length > 0) {
            const fileContents = await Promise.all(attachedFiles.map(async (file) => {
                try {
                    const content = await file.text();
                    return `=== File: ${file.name} ===\n${content}`;
                } catch (e) {
                    return `[Error reading ${file.name}]`;
                }
            }));
            const combinedContent = fileContents.join('\n\n');
            fullContextText = rawInputText ? `${rawInputText}\n\n${combinedContent}` : combinedContent;
        }

        // 2. Detect Mode
        const isPatchMode = this.detectPatchMode(fullContextText, attachedFiles);

        // 3. UI Transition
        if (this.dom.inputWrapper.classList.contains('centered')) {
            this.dom.inputWrapper.classList.remove('centered');
            this.dom.inputWrapper.classList.add('bottom');
            setTimeout(() => { this.dom.outputArea.classList.remove('hidden'); }, 300);
        }

        // 4. Get Tags & Reset UI
        const activeTags = Array.from(this.dom.tagContainer.children).map(t => t.firstChild.textContent);
        this.resetInputUI();

        // 5. Render
        this.renderUserMessage(rawInputText, attachedFiles, activeTags);

        // 6. Dispatch Logic
        if (isPatchMode) {
            await PatchManager.handleInput(fullContextText, this.dom.outputArea, () => {});
        } else if (activeTags.includes('Prompt')) {
            // 新增：Prompt 模式处理
            await this.handlePromptGeneration(rawInputText);
        } else {
            // 普通聊天或其他模式（暂留空或做简单的回显）
            this.renderSystemMessage(`Echo: ${rawInputText} (Select 'Prompt' or 'Patch' mode for more actions)`);
        }
    },

    // --- 新增 Prompt 生成逻辑 ---

    async handlePromptGeneration(userGoal) {
        // 1. 显示加载中
        const loadingId = this.renderLoading("正在分析需求要素...");
        
        try {
            // 2. 调用 LLM 分析维度
            const analysisData = await LLMEngine.analyzeRequirements(userGoal);
            this.removeLoading(loadingId);

            // 3. 渲染选项表单
            this.renderAnalysisForm(userGoal, analysisData);

        } catch (error) {
            this.removeLoading(loadingId);
            this.renderSystemMessage(`<div class="error-banner">分析失败: ${error.message}</div>`);
        }
    },

    renderAnalysisForm(userGoal, data) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-row ai';
        
        const formContainer = document.createElement('div');
        formContainer.className = 'chat-bubble ai form-bubble';
        
        let html = `<h3 class="form-title">🎯 需求定制: ${userGoal}</h3><form id="req-form">`;
        
        data.dimensions.forEach((dim, index) => {
            html += `<div class="form-group-item">
                <label class="form-label">${dim.name}</label>
                <div class="form-options">`;
            
            dim.options.forEach(opt => {
                const inputType = dim.multi ? 'checkbox' : 'radio';
                const nameAttr = dim.key || `dim_${index}`;
                // 默认选中第一个单选框
                const checked = (!dim.multi && opt === dim.options[0]) ? 'checked' : '';
                
                html += `
                    <label class="option-chip">
                        <input type="${inputType}" name="${nameAttr}" value="${opt}" ${checked}>
                        <span>${opt}</span>
                    </label>
                `;
            });
            html += `</div></div>`;
        });

        html += `<div class="form-actions-row">
                    <button type="button" class="btn-primary" id="btn-gen-prompt">
                        <span class="material-symbols-outlined">auto_awesome</span> 生成最终 Prompt
                    </button>
                 </div></form>`;

        formContainer.innerHTML = html;
        wrapper.appendChild(formContainer);
        this.dom.outputArea.appendChild(wrapper);
        this.dom.outputArea.scrollTop = this.dom.outputArea.scrollHeight;

        // 绑定生成按钮事件
        const btn = formContainer.querySelector('#btn-gen-prompt');
        btn.addEventListener('click', () => {
            const form = formContainer.querySelector('#req-form');
            const formData = new FormData(form);
            const selections = {};

            // 收集表单数据
            for (let [key, value] of formData.entries()) {
                if (selections[key]) {
                    if (!Array.isArray(selections[key])) selections[key] = [selections[key]];
                    selections[key].push(value);
                } else {
                    selections[key] = value;
                }
            }

            // 移除表单交互（避免重复提交），改为静态展示
            formContainer.innerHTML = `<div style="color:var(--text-3);">✅ 已选择配置，正在生成...</div>`;
            this.executeFinalGeneration(userGoal, selections);
        });
    },

    async executeFinalGeneration(userGoal, selections) {
        const loadingId = this.renderLoading("正在撰写详细 Prompt...");
        try {
            const finalPrompt = await LLMEngine.generateFinalPrompt(userGoal, selections);
            this.removeLoading(loadingId);
            
            // 渲染最终结果
            this.renderSystemMessage(`
                <div style="margin-bottom:8px; font-weight:bold; color:var(--text-1);">✨ Generated Prompt:</div>
                <div class="code-block-wrapper">
                    <pre style="white-space:pre-wrap; font-family:'JetBrains Mono'; font-size:0.9rem;">${finalPrompt.replace(/</g, "&lt;")}</pre>
                </div>
                <button class="btn-secondary" style="margin-top:12px;" onclick="navigator.clipboard.writeText(this.previousElementSibling.innerText); this.innerText='已复制'">
                    <span class="material-symbols-outlined">content_copy</span> 复制 Prompt
                </button>
            `);
        } catch (error) {
            this.removeLoading(loadingId);
            this.renderSystemMessage(`<div class="error-banner">生成失败: ${error.message}</div>`);
        }
    },

    renderSystemMessage(contentOrHtml) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-row ai';
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ai';
        bubble.style.width = '100%';
        
        if (typeof contentOrHtml === 'string') {
            bubble.innerHTML = contentOrHtml;
        } else {
            bubble.appendChild(contentOrHtml);
        }
        
        wrapper.appendChild(bubble);
        this.dom.outputArea.appendChild(wrapper);
        this.dom.outputArea.scrollTop = this.dom.outputArea.scrollHeight;
    },

    renderLoading(text) {
        const id = 'loading-' + Date.now();
        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = 'chat-row ai';
        wrapper.innerHTML = `
            <div class="chat-bubble ai">
                <div style="display:flex; align-items:center; gap:10px; color:var(--text-3);">
                    <span class="material-symbols-outlined spin">sync</span>
                    <span>${text}</span>
                </div>
            </div>`;
        this.dom.outputArea.appendChild(wrapper);
        this.dom.outputArea.scrollTop = this.dom.outputArea.scrollHeight;
        return id;
    },

    removeLoading(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    },

    detectPatchMode(text, files) {
        let isPatch = Array.from(this.dom.tagContainer.children).some(tag => tag.textContent.includes('Patch'));
        if (!isPatch) {
            const hasPatchMarker = text.includes('<<<<<<< SEARCH');
            const hasPatchFile = files.some(f => f.name.toLowerCase().includes('patch'));
            if (hasPatchMarker || (hasPatchFile && text.includes('FILE:'))) {
                isPatch = true;
            }
        }
        return isPatch;
    },

    resetInputUI() {
        this.dom.mainInput.value = '';
        this.dom.mainInput.style.height = '30px'; // Reset to default CSS height
        this.dom.filePreviewArea.innerHTML = '';
        this.dom.filePreviewArea.classList.add('hidden');
        this.inputFiles = [];
    },

    renderUserMessage(text, files, tags) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-row user';
        
        const safeText = text
            ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            : '';
        
        let metaHtml = '';
        if (files.length > 0 || tags.length > 0) {
            const tagsHtml = tags.map(t => `<div class="history-tag"><span class="material-symbols-outlined">label</span><span>${t}</span></div>`).join('');
            const filesHtml = files.map(f => {
                const ext = f.name.split('.').pop() || 'FILE';
                return `
                    <div class="file-card">
                        <div class="file-name">${f.name}</div>
                        <div class="file-type">${ext}</div>
                    </div>`;
            }).join('');
            metaHtml = `<div class="user-meta-header">${tagsHtml}${filesHtml}</div>`;
        }

        wrapper.innerHTML = `
            <div class="user-stack">
                ${metaHtml}
                ${safeText ? `<div class="chat-bubble user" style="white-space: pre-wrap;">${safeText}</div>` : ''}
            </div>
        `;
        this.dom.outputArea.appendChild(wrapper);
        this.dom.outputArea.scrollTop = this.dom.outputArea.scrollHeight;
    }
};