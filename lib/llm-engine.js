import { Store } from '../store.js';

export const LLMEngine = {
    /**
     * 通用的 API 请求函数
     */
    async callAPI(messages) {
        const { baseUrl, apiKey, modelName } = Store.state.apiConfig;
        
        if (!apiKey) {
            throw new Error("请先在设置中配置 API Key");
        }

        // 兼容处理 Base URL (移除末尾斜杠)
        const endpoint = baseUrl ? baseUrl.replace(/\/$/, '') : 'https://api.openai.com/v1';
        const url = `${endpoint}/chat/completions`;

        const payload = {
            model: modelName || "gpt-3.5-turbo",
            messages: messages,
            temperature: 0.7
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || `API Error: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0]?.message?.content || "";
        } catch (error) {
            console.error("LLM Call Failed:", error);
            throw error;
        }
    },

    /**
     * 阶段一：分析用户需求，返回 JSON 选项
     */
    async analyzeRequirements(userGoal) {
        const systemPrompt = `
你是一个专业的软件需求分析师。你的任务是分析用户的简短需求，并将其拆解为多个核心维度的选项，以便用户进行选择。
请严格只返回符合以下格式的 JSON 数据，不要包含 markdown 标记或其他废话：

{
  "dimensions": [
    {
      "name": "技术栈", 
      "key": "tech_stack",
      "options": ["原生 HTML/JS", "React", "Vue", "Python/Streamlit"]
    },
    {
      "name": "核心功能",
      "key": "features", 
      "multi": true,
      "options": ["选项A", "选项B"]
    }
  ]
}

注意：
1. "name" 是显示给用户的标题。
2. "options" 是具体的候选项。
3. 根据用户的输入 "${userGoal}" 动态生成最相关的维度（例如：运行环境、视觉风格、核心规则等）。
`;

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userGoal }
        ];

        const rawContent = await this.callAPI(messages);
        return this.cleanAndParseJSON(rawContent);
    },

    /**
     * 阶段二：根据用户选择生成最终 Prompt
     */
    async generateFinalPrompt(userGoal, selections) {
        let selectionText = "";
        for (const [key, value] of Object.entries(selections)) {
            selectionText += `- ${key}: ${Array.isArray(value) ? value.join(', ') : value}\n`;
        }

        const prompt = `
我需要编写一个详细的 AI Prompt 来生成代码。
原始需求：${userGoal}
用户选定的约束条件：
${selectionText}

请基于以上信息，编写一个结构清晰、详细的 Prompt，用于指导 AI 编写代码。
请包含：角色定义、详细的功能列表、技术规范、代码风格要求。
`;
        
        const messages = [{ role: "user", content: prompt }];
        return await this.callAPI(messages);
    },

    /**
     * 辅助工具：清洗并解析 JSON（防止 LLM 返回 Markdown 包裹）
     */
    cleanAndParseJSON(text) {
        try {
            // 尝试直接解析
            return JSON.parse(text);
        } catch (e) {
            // 尝试提取 ```json ... ``` 中的内容
            const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match && match[1]) {
                return JSON.parse(match[1]);
            }
            // 尝试提取第一个 { 和最后一个 } 之间的内容
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                return JSON.parse(text.substring(start, end + 1));
            }
            throw new Error("无法解析 LLM 返回的 JSON");
        }
    }
};