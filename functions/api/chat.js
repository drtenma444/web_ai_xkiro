// functions/api/chat.js
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { messages } = await request.json();

    const response = await fetch('https://api.xkiro.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.XKIRO_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b:free',
        messages: messages
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: `Xkiro API error: ${response.status} ${errorText}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
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
