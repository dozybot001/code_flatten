import { ProjectCore } from './core.js';
import { Store } from './store.js';

export const PatchManager = {
    currentMatches: [],

    /**
     * 处理 Patch 逻辑入口
     * @param {string} inputText 用户输入的 Patch 文本
     * @param {HTMLElement} outputArea 聊天输出区域容器
     * @param {Function} renderMessageCallback 回调函数，用于渲染普通文本
     */
    async handleInput(inputText, outputArea, renderMessageCallback) {
        // 渲染用户的原始指令（右侧）
        renderMessageCallback(inputText);

        // 辅助函数：渲染系统消息（左侧 - AI 气泡）
        const renderSystemMessage = (element) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'chat-row ai';
            
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble ai';

            // 智能检测：如果是 Diff 视图，强制使用宽模式
            if (element.classList.contains('diff-container')) {
                bubble.classList.add('bubble-wide');
            }
            
            bubble.appendChild(element);
            wrapper.appendChild(bubble);
            
            outputArea.appendChild(wrapper);
            outputArea.scrollTop = outputArea.scrollHeight;
        };

        // 1. 检查是否有 Context
        if (!Store.state.contextContent) {
            const errDiv = document.createElement('div');
            errDiv.innerHTML = `<div class="error-banner"><span class="material-symbols-outlined">error</span> No context loaded. Please upload files and click "Merge Project" or "Context TXT" first.</div>`;
            renderSystemMessage(errDiv);
            return;
        }

        // 2. 解析 & 查找
        const patches = ProjectCore.PatchEngine.parseInput(inputText);
        if (patches.length === 0) {
            const hint = document.createElement('div');
            hint.innerHTML = `<div style="color:var(--text-4); margin-left:10px; font-size:0.9rem; padding: 10px; background: var(--bg-translucent-faint); border-radius: 8px; display:inline-block;">⚠️ No valid search/replace blocks found. Use the standard format defined in patch.md</div>`;
            renderSystemMessage(hint);
            return;
        }

        const matches = ProjectCore.PatchEngine.findMatches(Store.state.contextContent, patches);
        this.currentMatches = matches; 

        const onApplySuccess = (count) => {
            const successDiv = document.createElement('div');
            successDiv.innerHTML = `
                <div style="background:var(--gray-l2); color:var(--state-success-text); padding:16px; border-radius:8px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:8px;">
                    <span class="material-symbols-outlined" style="font-size:32px;">check_circle</span>
                    <strong>${count} Patches Applied Successfully</strong>
                    <div style="font-size:0.85rem; opacity: 0.8;">Memory updated. You can now rebuild or apply more patches.</div>
                </div>
            `;
            renderSystemMessage(successDiv);
        };

        const container = this.renderDiffUI(matches, onApplySuccess);
        renderSystemMessage(container);
    },

    renderDiffUI(matches, onApplySuccess) {
        // 动态注入样式，支持点击删除线效果
        if (!document.getElementById('patch-interaction-styles')) {
            const style = document.createElement('style');
            style.id = 'patch-interaction-styles';
            style.textContent = `
                .diff-card.interactive { cursor: pointer; transition: opacity 0.2s, filter 0.2s; user-select: none; }
                .diff-card.patch-excluded { opacity: 0.4; filter: grayscale(1); }
                .diff-card.patch-excluded .diff-file-name { text-decoration: line-through; color: var(--text-4); }
                .diff-card.patch-excluded .diff-header { background: var(--surface-2); }
            `;
            document.head.appendChild(style);
        }

        const container = document.createElement('div');
        container.className = 'diff-container';
        
        container.innerHTML = `<h3 style="color:var(--text-2); margin-bottom:8px;">Diff Preview (${matches.filter(m=>m.isValid).length} matches)</h3><div style="font-size:0.8rem; color:var(--text-4); margin-bottom:12px;">Tap on a card to exclude it (strikethrough).</div>`;

        matches.forEach((match, idx) => {
            const card = document.createElement('div');
            card.className = 'diff-card';
            
            // 将索引绑定在 Card 元素上，便于后续获取
            card.dataset.idx = idx;

            if (match.isValid) {
                card.classList.add('interactive'); // 标记为可交互
                card.title = "Click to exclude this change";
                
                // 点击切换排除状态
                card.addEventListener('click', () => {
                    card.classList.toggle('patch-excluded');
                });

                card.innerHTML = `
                    <div class="diff-header">
                        <div class="diff-file-name">
                            <span class="material-symbols-outlined">description</span>
                            ${match.file}
                        </div>
                        <div class="diff-status-icon">
                            <span class="material-symbols-outlined icon-include" style="color:var(--state-success-text)">check</span>
                        </div>
                    </div>
                    <div class="diff-content">
                        <div class="diff-half">
                            <div class="diff-pane-header">Original (Search)</div>
                            <div class="diff-block diff-old">${this.escapeHtml(match.original)}</div>
                        </div>
                        <div class="diff-half">
                            <div class="diff-pane-header">Modified (Replace)</div>
                            <div class="diff-block diff-new">${this.escapeHtml(match.replacement)}</div>
                        </div>
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <div class="diff-header" style="background:var(--gray-l2);">
                        <div class="diff-file-name" style="color:var(--state-error-text);">
                            <span class="material-symbols-outlined">warning</span>
                            Match Failed
                        </div>
                    </div>
                    <div class="diff-block" style="color:var(--state-error-text);">${match.error}<br/><small>Searched for:</small><br/>${this.escapeHtml(match.original.substring(0, 100))}...</div>
                `;
            }
            container.appendChild(card);
        });

        // Confirm Actions
        const validCount = matches.filter(m => m.isValid).length;
        if (validCount > 0) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'patch-confirm-area';
            actionsDiv.innerHTML = `
                <button class="btn-secondary" id="btn-cancel-patch">Cancel</button>
                <button class="btn-primary" id="btn-apply-patch">
                    <span class="material-symbols-outlined">check</span>
                    Apply Changes
                </button>
            `;
            container.appendChild(actionsDiv);
            
            // 绑定事件
            this.bindActionEvents(container, onApplySuccess);
        }

        return container;
    },

    bindActionEvents(container, onApplySuccess) {
        const btnApply = container.querySelector('#btn-apply-patch');
        const btnCancel = container.querySelector('#btn-cancel-patch');

        if (btnApply) {
            btnApply.addEventListener('click', () => {
                // 筛选逻辑变更：选择所有未被标记为 'patch-excluded' 且有效的 Card
                const activeCards = container.querySelectorAll('.diff-card.interactive:not(.patch-excluded)');
                const selectedIndices = Array.from(activeCards).map(card => parseInt(card.dataset.idx));
                const selectedMatches = this.currentMatches.filter((_, i) => selectedIndices.includes(i));

                if (selectedMatches.length === 0) {
                    alert("No patches selected. Click cards to include/exclude them.");
                    return;
                }

                // Apply Logic
                const newContext = ProjectCore.PatchEngine.applyPatches(Store.state.contextContent, selectedMatches);
                Store.state.contextContent = newContext; // Update Store

                // 1. UI Update: 移除操作按钮，标记 Diff 区域为已处理
                const actionArea = container.querySelector('.patch-confirm-area');
                if (actionArea) {
                    actionArea.innerHTML = `<div style="text-align:center; color:var(--text-4); padding:10px; font-style:italic;">Changes applied to memory.</div>`;
                }

                // 2. Feedback UI: 在下方发送一条新消息
                if (onApplySuccess) {
                    onApplySuccess(selectedMatches.length);
                }
                
                // 更新侧边栏时间 (Optional, DOM decoupling via global search)
                const dateEl = document.getElementById('ctx-date-text');
                if (dateEl) {
                    const now = new Date();
                    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
                    dateEl.textContent = `${timeStr} (Patched)`;
                }
            });
        }

        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                container.remove();
            });
        }
    },

    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};