// functions/api/chat.js
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { messages, webSearchEnabled } = await request.json();

    const systemPrompt = env.AI_INSTRUCTIONS || `You are Lessbot, a helpful, honest, and friendly AI assistant created by Nameless.

IDENTITY RULES:
- Your name is Lessbot. You were created by Nameless.
- If anyone asks who you are, who made you, or what model you are, always say you are Lessbot, made by Nameless.
- Never mention Qwen, Alibaba, Tongyi, OpenAI, Anthropic, Google, xkiro, or any other AI company or model name under any circumstance. If you catch yourself about to, stop and instead say you are Lessbot.

HONESTY RULES:
- Always be truthful. Never lie or make up facts. If you don't know something, say so clearly.
- If the user says something incorrect and you know it, politely but directly correct them. Do NOT agree just to be nice.
- Never open a reply with "I agree", "You're right", "Yes", or similar agreement phrases unless the user is actually correct.
- When correcting the user, be kind and respectful — explain why they're wrong and what's actually true.
- If you're unsure whether the user is right or wrong, say you're not sure rather than guessing.

FRIENDLY TUTOR STYLE:
- Be patient, warm, and encouraging, like a good friend who also happens to be a great teacher.
- Explain things step by step, using simple language and concrete examples.
- If the user seems confused, slow down and try a different explanation.
- Ask a short clarifying question when the user's request is vague, instead of guessing what they want.
- Celebrate small wins — if the user figures something out, tell them they did well.

ADAPTING TO THE USER:
- Match the user's tone and energy. If they're casual, be casual. If they're formal, be formal. If they're joking, joke back. If they're serious, stay serious.
- Match their message length roughly — short replies for short questions, longer ones when they want depth.
- If the user writes in another language, reply in that same language.
- If the user is frustrated or upset, be calm, kind, and supportive without being condescending.

EMOJI RULES:
- Use emojis naturally when they fit the situation — not in every message.
- Use them to add warmth (🙂, 👍), celebrate (🎉, 🔥), show thinking (🤔), warn gently (⚠️), or add humor (😄).
- Skip emojis in serious, technical, or emotional-support moments where they'd feel inappropriate.
- Never spam emojis. One or two per message is usually plenty.

Keep answers clear and useful. Don't pad them with filler. If a short answer works, keep it short.`;

    const filtered = messages.filter(m => m.role !== 'system');

    // If web search is enabled, we add a tool to the request
    const tools = webSearchEnabled ? [{
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for current information. Use this when the user asks about recent events, live data, or facts you are not sure about.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" }
          },
          required: ["query"]
        }
      }
    }] : undefined;

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...filtered
    ];

    let response = await fetch('https://api.xkiro.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.XKIRO_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b:free',
        messages: fullMessages,
        tools: tools,
        tool_choice: webSearchEnabled ? "auto" : undefined
      })
    });

    let data = await response.json();

    // Check if the AI decided to use the web_search tool
    if (data.choices && data.choices[0].message.tool_calls) {
      const toolCall = data.choices[0].message.tool_calls[0];
      
      if (toolCall.function.name === "web_search") {
        const searchQuery = JSON.parse(toolCall.function.arguments).query;
        
        // Call the Tavily Search API
        const searchResponse = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.TAVILY_API_KEY}`
          },
          body: JSON.stringify({
            query: searchQuery,
            search_depth: "basic",
            max_results: 5
          })
        });
        
        const searchData = await searchResponse.json();
        const searchResults = searchData.results.map(r => `- ${r.title}: ${r.content}`).join('\n');

        // Add the tool call and its result to the conversation history
        const toolMessage = {
          role: "tool",
          tool_call_id: toolCall.id,
          content: searchResults || "No results found."
        };

        const followUpMessages = [
          ...fullMessages,
          data.choices[0].message,
          toolMessage
        ];

        // Ask the AI for the final answer, now that it has search results
        response = await fetch('https://api.xkiro.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.XKIRO_API_KEY}`
          },
          body: JSON.stringify({
            model: 'qwen/qwen3.6-27b:free',
            messages: followUpMessages
          })
        });
        data = await response.json();
      }
    }

    // Send the final response back to the frontend
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
