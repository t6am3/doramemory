import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LLMConfig } from '../types.js'

export async function callLLM(config: LLMConfig, prompt: string): Promise<string> {
  if (config.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: config.api_key })
    const msg = await client.messages.create({
      model:      config.model_id,
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    })
    const block = msg.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic')
    return block.text
  }

  // openai or custom both use the OpenAI SDK
  const client = new OpenAI({
    apiKey:  config.api_key ?? 'none',
    baseURL: config.base_url,
  })
  const res = await client.chat.completions.create({
    model:    config.model_id,
    messages: [{ role: 'user', content: prompt }],
  })
  return res.choices[0]?.message?.content ?? ''
}
