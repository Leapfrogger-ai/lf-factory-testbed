---
status: accepted
initiative: calvin
---

# Plan suggestions use Sonnet 5.5 with web search and a strict `propose_plan` tool

Suggestions call `claude-sonnet-5-5` with the server-side web search tool (`max_uses: 2`, `user_location` set to the chosen city) so venues are checked as real and open. That's the brief's riskiest assumption, and it's chosen over a cheaper model without search. The answer comes back through a strict client tool, `propose_plan`, with `tool_choice: auto`. Sonnet 5.5 rejects forced tool choice, and `output_config.format` is not documented as compatible with web search citations. A response without a `propose_plan` call, or one that ends in `pause_turn`, `refusal` or `max_tokens`, or takes longer than 20s, falls back to the empty form (FR004).

## Consequences

- Latency is the risk: the docs give no figures for search latency. NFR001 (≤15s p95) must be measured in the first suggestion story; dropping `max_uses` to 1 is the first lever.
- About $0.05–0.07 per suggestion (estimated).
