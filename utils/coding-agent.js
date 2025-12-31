// coding-agent.js
import { 
    SYSTEM_PROMPT_IDENTIFY, 
    SYSTEM_PROMPT_GENERATE, 
    buildIdentifyUserPrompt, 
    buildGenerateUserPrompt 
} from './lib/prompts.js';
import { applyPatchesMultiFile } from './lib/patch-engine.js';

export class CodingAgent {
    constructor(aiService) {
        this.ai = aiService;
    }

    /**
     * 业务逻辑 1: 分析相关文件
     */
    async identifyRelevantFiles(userQuery, repoMap) {
        const systemPrompt = SYSTEM_PROMPT_IDENTIFY;
        const userPrompt = buildIdentifyUserPrompt(repoMap, userQuery);

        // 调用通用的 AI 接口
        const content = await this.ai.callAI({
            systemPrompt,
            userPrompt,
            temperature: 0.1 // 确定性较高
        });

        // 业务特定的解析逻辑 (清洗 Markdown 标记)
        const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Failed to parse AI response as JSON", content);
            throw new Error("AI response format error: Expected JSON array.");
        }
    }

    /**
     * 业务逻辑 2: 生成代码补丁
     */
    async generateCodeEdits(userQuery, fileContexts) {
        // 序列化文件上下文
        const contextStr = fileContexts.map(f => 
            `--- FILE: ${f.path} ---\n${f.content}\n--- END OF FILE ---`
        ).join('\n\n');

        const systemPrompt = SYSTEM_PROMPT_GENERATE;
        const userPrompt = buildGenerateUserPrompt(contextStr, userQuery);

        // 直接返回文本内容，由 patch-engine 进一步处理
        return await this.ai.callAI({
            systemPrompt,
            userPrompt,
            temperature: 0.2 // 需要一定的创造性但保持精确
        });
    }

    /**
     * 业务逻辑 3: 生成并尝试应用补丁 (Composite Action)
     * 返回: { pendingChangesMap, patchCount }
     */
    async generateAndApplyEdits(query, fileContexts) {
        // 1. 生成 Diff
        const edits = await this.generateCodeEdits(query, fileContexts);

        // 2. 解析并应用
        const rawMap = applyPatchesMultiFile(fileContexts, edits);

        // 3. 过滤无变化文件 (只返回真正修改的部分)
        const pendingChangesMap = {};
        let patchCount = 0;

        for (const [path, newContent] of Object.entries(rawMap)) {
            const original = fileContexts.find(f => f.path === path)?.content;
            if (original && original !== newContent) {
                pendingChangesMap[path] = newContent;
                patchCount++;
            }
        }

        return { pendingChangesMap, patchCount };
    }
}