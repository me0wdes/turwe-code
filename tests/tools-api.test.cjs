const { test } = require("node:test");
const assert = require("node:assert/strict");
const { streamChat } = require("../electron/api.cjs");
const config = {
  baseUrl: "https://example.test/v1",
  key: "test",
  model: "vision",
  onDelta: () => {},
  messages: [],
};
const event = (data) => "data: " + JSON.stringify({ choices: [data] }) + "\n\n";
test("incomplete and filtered responses are not accepted as completed turns or executable tool calls", async () => {
  for (const reason of [
    "length",
    "max_tokens",
    "content_filter",
    "model_context_window_exceeded",
    "pause_turn",
  ]) {
    for (const streaming of [true, false]) {
      let text = "";
      const message = {
        content: "Частичный ответ",
        tool_calls: [
          {
            id: "c",
            type: "function",
            function: { name: "Bash", arguments: '{"command":"echo test"}' },
          },
        ],
      };
      await assert.rejects(
        streamChat({
          ...config,
          onDelta: (chunk) => {
            text += chunk;
          },
          fetchImpl: async () =>
            streaming
              ? new Response(
                  event({
                    delta: {
                      ...message,
                      tool_calls: message.tool_calls.map((call) => ({
                        ...call,
                        index: 0,
                      })),
                    },
                    finish_reason: reason,
                  }) + "data: [DONE]\n\n",
                )
              : Response.json({
                  choices: [{ message, finish_reason: reason }],
                }),
        }),
        /лимит|останов|пауз|фильтр/,
      );
      assert.equal(text, "Частичный ответ");
    }
  }
});
test("a provider announcing tools without their payload is an error even with commentary", async () => {
  for (const fetchImpl of [
    async () =>
      new Response(
        event({ delta: { content: "Сейчас поищу." } }) +
          event({ delta: {}, finish_reason: "tool_calls" }) +
          "data: [DONE]\n\n",
      ),
    async () =>
      Response.json({
        choices: [
          {
            message: { content: "Сейчас поищу." },
            finish_reason: "tool_calls",
          },
        ],
      }),
  ])
    await assert.rejects(streamChat({ ...config, fetchImpl }), /инструмент/);
});
test("fragmented parallel tool calls assemble without requiring text, metadata never reaches API", async () => {
  const content = [
    { type: "text", text: "Describe" },
    { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
  ];
  let request;
  const answer = await streamChat({
    ...config,
    messages: [{ role: "user", content }],
    tools: [
      {
        type: "function",
        function: { name: "lookup", parameters: { type: "object" } },
        mcp: { secret: "private" },
      },
    ],
    fetchImpl: async (_, init) => {
      request = JSON.parse(init.body);
      return new Response(
        event({
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_one",
                type: "function",
                function: { name: "lookup", arguments: '{"x":' },
              },
              {
                index: 1,
                id: "call_two",
                function: { name: "lookup", arguments: "{}" },
              },
            ],
          },
        }) +
          event({
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "1}" } }],
            },
            finish_reason: "tool_calls",
          }) +
          "data: [DONE]\n\n",
      );
    },
  });
  assert.deepEqual(request.messages[0].content, content);
  assert.equal(request.tools[0].mcp, undefined);
  assert.equal(answer.toolCalls[0].function.arguments, '{"x":1}');
  assert.equal(answer.toolCalls[1].id, "call_two");
});
test("JSON tool-only response works and malformed arguments fail before execution", async () => {
  const fetchImpl = async () =>
    Response.json({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "c",
                type: "function",
                function: { name: "lookup", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
  assert.equal(
    (await streamChat({ ...config, fetchImpl })).toolCalls[0].id,
    "c",
  );
  await assert.rejects(
    streamChat({
      ...config,
      fetchImpl: async () =>
        new Response(
          event({
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c",
                  function: { name: "lookup", arguments: '{"broken"' },
                },
              ],
            },
            finish_reason: "tool_calls",
          }) + "data: [DONE]\n\n",
        ),
    }),
    /аргумент/,
  );
});
