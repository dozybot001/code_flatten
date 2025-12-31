// ai-service.js
export class AIService {
    constructor() {
        this.config = {
            apiKey: localStorage.getItem('caret_api_key') || '',
            baseUrl: localStorage.getItem('caret_base_url') || '',
            model: localStorage.getItem('caret_model') || ''
        };
    }

    saveConfig(apiKey, baseUrl, model) {
        this.config.apiKey = apiKey;
        this.config.baseUrl = baseUrl;
        this.config.model = model;
        
        localStorage.setItem('caret_api_key', apiKey);
        localStorage.setItem('caret_base_url', baseUrl);
        localStorage.setItem('caret_model', model);
    }

    hasKey() {
        return !!this.config.apiKey;
    }

    /**
     * Generic AI Call
     * @param {Object} params
     * @param {string} params.systemPrompt
     * @param {string} params.userPrompt
     * @param {number} [params.temperature=0.7]
     */
    async callAI({ systemPrompt, userPrompt, temperature = 0.7 }) {
        if (!this.config.apiKey) throw new Error("API Key is missing");

        try {
            const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                body: JSON.stringify({
                    model: this.config.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: temperature
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || `API Request Failed: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content.trim();

        } catch (error) {
            console.error("AI Service Network Error:", error);
            throw error;
        }
    }
}