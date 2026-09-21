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

    // --- Inject current time (always) ---
    const now = new Date();
    const currentTimeContext = `\n\n--- CURRENT TIME ---\nThe current UTC time is: ${now.toUTCString()}\nThe current time in Bangladesh (BST, UTC+6) is: ${new Date(now.getTime() + 6 * 60 * 60 * 1000).toUTCString().replace('GMT', 'BST')}\nUse this information when the user asks about the current time or date.\n--- END CURRENT TIME ---`;

    // --- Pre-search if enabled ---
    let searchContext = '';
    if (webSearchEnabled) {
      const lastUser = [...filtered].reverse().find(m => m.role === 'user');

      if (!env.TAVILY_API_KEY) {
        console.error('TAVILY_API_KEY is not set in environment');
      } else if (lastUser && lastUser.content) {
        try {
          const searchRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.TAVILY_API_KEY}`
            },
            body: JSON.stringify({
              query: lastUser.content,
              search_depth: 'basic',
              max_results: 5
            })
          });

          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
              const resultsText = searchData.results.map((r, i) => {
                const title = r.title || 'Untitled';
                const url = r.url || '';
                const content = r.content || '';
                return `[${i + 1}] ${title}\nURL: ${url}\n${content}`;
              }).join('\n\n');

              searchContext = `\n\n--- WEB SEARCH RESULTS ---\nThe user has web search enabled. Use the following fresh results to answer their question accurately. Cite sources when relevant. If the results don't contain what's needed, say so instead of guessing.\n\n${resultsText}\n--- END SEARCH RESULTS ---`;
            } else {
              searchContext = `\n\n--- WEB SEARCH RESULTS ---\n(Web search was performed but returned no results. Answer from your own knowledge, and if you're unsure, say so.)\n--- END SEARCH RESULTS ---`;
            }
          } else {
            console.error('Tavily error:', searchRes.status);
            searchContext = `\n\n--- WEB SEARCH RESULTS ---\n(Web search failed. Answer from your own knowledge.)\n--- END SEARCH RESULTS ---`;
          }
        } catch (e) {
          console.error('Tavily exception:', e.message);
          searchContext = `\n\n--- WEB SEARCH RESULTS ---\n(Web search encountered an error. Answer from your own knowledge.)\n--- END SEARCH RESULTS ---`;
        }
      }
    }

    const fullMessages = [
      { role: 'system', content: systemPrompt + currentTimeContext + searchContext },
      ...filtered
    ];

    // --- Call xkiro with streaming enabled ---
    const upstream = await fetch('https://api.xkiro.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.XKIRO_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b:free',
        messages: fullMessages,
        stream: true
      })
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return new Response(
        JSON.stringify({ error: `Xkiro API error: ${upstream.status} ${errorText}` }),
        { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Pipe the SSE stream straight through
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
