/** Official connection defaults; source pinned for reviewable parity updates.
 * https://github.com/NousResearch/hermes-agent/tree/ed1afb082eb3e46cf2edae9d8f68fb67b09ee4df
 * hermes_cli/auth.py + plugins/model-providers/*; hidden profiles are not defaults.
 * Transport/auth remain backend-owned. No credentials or user configuration here.
 */
export const OFFICIAL_PROVIDER_SOURCE = "ed1afb082eb3e46cf2edae9d8f68fb67b09ee4df";
export interface OfficialProvider {
  id: string;
  name: string;
  baseUrl: string;
  envKeys: string[];
  auth: string;
  aliases: string[];
  plugin: string;
  apiMode: string;
  url: string;
  hidden: boolean;
  modelListing: boolean;
  oauth?: boolean;
  setupHint?: string;
}
export const OFFICIAL_PROVIDERS: OfficialProvider[] = [
  {
    "id": "actual",
    "name": "Actual Computer",
    "baseUrl": "https://api.actual.inc/v1",
    "envKeys": [
      "ACTUAL_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "actual-computer",
      "actualcomputer",
      "aci"
    ],
    "plugin": "actual",
    "apiMode": "chat_completions",
    "url": "https://actual.inc",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "ai-gateway",
    "name": "Vercel AI Gateway",
    "baseUrl": "https://ai-gateway.vercel.sh/v1",
    "envKeys": [
      "AI_GATEWAY_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "vercel",
      "vercel-ai-gateway",
      "ai_gateway",
      "aigateway"
    ],
    "plugin": "ai-gateway",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "alibaba",
    "name": "Qwen Cloud",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "envKeys": [
      "DASHSCOPE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "dashscope",
      "alibaba-cloud",
      "qwen-dashscope",
      "aliyun"
    ],
    "plugin": "alibaba",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "alibaba-cn",
    "name": "Alibaba Cloud DashScope (China)",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "envKeys": [
      "DASHSCOPE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "dashscope-cn",
      "alibaba-cloud-cn"
    ],
    "plugin": "alibaba",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "alibaba-coding-plan",
    "name": "Alibaba Cloud (Coding Plan)",
    "baseUrl": "https://coding-intl.dashscope.aliyuncs.com/v1",
    "envKeys": [
      "ALIBABA_CODING_PLAN_API_KEY",
      "DASHSCOPE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "alibaba_coding",
      "alibaba-coding",
      "dashscope-coding"
    ],
    "plugin": "alibaba-coding-plan",
    "apiMode": "chat_completions",
    "url": "https://help.aliyun.com/zh/model-studio/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "alibaba-coding-plan-cn",
    "name": "Alibaba Cloud (Coding Plan, China)",
    "baseUrl": "https://coding.dashscope.aliyuncs.com/v1",
    "envKeys": [
      "ALIBABA_CODING_PLAN_CN_API_KEY",
      "ALIBABA_CODING_PLAN_API_KEY",
      "DASHSCOPE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "alibaba-coding-cn",
      "dashscope-coding-cn"
    ],
    "plugin": "alibaba-coding-plan",
    "apiMode": "chat_completions",
    "url": "https://help.aliyun.com/zh/model-studio/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "alibaba-token-plan",
    "name": "Alibaba Cloud (Token Plan)",
    "baseUrl": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    "envKeys": [
      "ALIBABA_TOKEN_PLAN_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "dashscope-token-plan"
    ],
    "plugin": "alibaba",
    "apiMode": "chat_completions",
    "url": "https://help.aliyun.com/zh/model-studio/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "alibaba-token-plan-cn",
    "name": "Alibaba Cloud (Token Plan, China)",
    "baseUrl": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "envKeys": [
      "ALIBABA_TOKEN_PLAN_CN_API_KEY",
      "ALIBABA_TOKEN_PLAN_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "dashscope-token-plan-cn"
    ],
    "plugin": "alibaba",
    "apiMode": "chat_completions",
    "url": "https://help.aliyun.com/zh/model-studio/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "anthropic",
    "name": "Anthropic",
    "baseUrl": "https://api.anthropic.com",
    "envKeys": [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN"
    ],
    "auth": "api_key",
    "aliases": [
      "claude",
      "claude-oauth",
      "claude-code"
    ],
    "plugin": "anthropic",
    "apiMode": "anthropic_messages",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true,
    "oauth": true
  },
  {
    "id": "arcee",
    "name": "Arcee AI",
    "baseUrl": "https://api.arcee.ai/api/v1",
    "envKeys": [
      "ARCEEAI_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "arcee-ai",
      "arceeai"
    ],
    "plugin": "arcee",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "azure-foundry",
    "name": "Azure Foundry",
    "baseUrl": "",
    "envKeys": [
      "AZURE_FOUNDRY_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "azure",
      "azure-ai-foundry",
      "azure-ai"
    ],
    "plugin": "azure-foundry",
    "apiMode": "chat_completions",
    "url": "https://ai.azure.com/",
    "hidden": false,
    "modelListing": false,
    "setupHint": "Configure with hermes model first; this desktop cannot provision cloud SDK credentials or deployment settings."
  },
  {
    "id": "bedrock",
    "name": "AWS Bedrock",
    "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "envKeys": [],
    "auth": "aws_sdk",
    "aliases": [
      "aws",
      "aws-bedrock",
      "amazon-bedrock",
      "amazon"
    ],
    "plugin": "bedrock",
    "apiMode": "bedrock_converse",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false,
    "setupHint": "Configure with hermes model first; this desktop cannot provision cloud SDK credentials or deployment settings."
  },
  {
    "id": "commandcode",
    "name": "CommandCode",
    "baseUrl": "https://api.commandcode.ai/provider/v1",
    "envKeys": [
      "COMMANDCODE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "commandcode-chat"
    ],
    "plugin": "commandcode",
    "apiMode": "chat_completions",
    "url": "https://commandcode.ai/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "commandcode-anthropic",
    "name": "CommandCode (Anthropic)",
    "baseUrl": "https://api.commandcode.ai/provider/v1",
    "envKeys": [
      "COMMANDCODE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "commandcode-claude"
    ],
    "plugin": "commandcode",
    "apiMode": "anthropic_messages",
    "url": "https://commandcode.ai/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "custom",
    "name": "custom",
    "baseUrl": "",
    "envKeys": [],
    "auth": "api_key",
    "aliases": [
      "ollama",
      "local",
      "vllm",
      "llamacpp",
      "llama.cpp",
      "llama-cpp"
    ],
    "plugin": "custom",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "deepinfra",
    "name": "DeepInfra",
    "baseUrl": "https://api.deepinfra.com/v1/openai",
    "envKeys": [
      "DEEPINFRA_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "deep-infra",
      "deepinfra-ai"
    ],
    "plugin": "deepinfra",
    "apiMode": "chat_completions",
    "url": "https://deepinfra.com/dash/api_keys",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "baseUrl": "https://api.deepseek.com/v1",
    "envKeys": [
      "DEEPSEEK_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "deepseek-chat",
      "deep-seek"
    ],
    "plugin": "deepseek",
    "apiMode": "chat_completions",
    "url": "https://platform.deepseek.com/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "fireworks",
    "name": "Fireworks AI",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "envKeys": [
      "FIREWORKS_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "fireworks-ai",
      "fw"
    ],
    "plugin": "fireworks",
    "apiMode": "chat_completions",
    "url": "https://app.fireworks.ai/settings/users/api-keys",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "gemini",
    "name": "Google AI Studio",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
    "envKeys": [
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "google",
      "google-gemini",
      "google-ai-studio"
    ],
    "plugin": "gemini",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false
  },
  {
    "id": "gmi",
    "name": "GMI Cloud",
    "baseUrl": "https://api.gmi-serving.com/v1",
    "envKeys": [
      "GMI_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "gmi-cloud",
      "gmicloud"
    ],
    "plugin": "gmi",
    "apiMode": "chat_completions",
    "url": "https://www.gmicloud.ai/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "huggingface",
    "name": "Hugging Face",
    "baseUrl": "https://router.huggingface.co/v1",
    "envKeys": [
      "HF_TOKEN"
    ],
    "auth": "api_key",
    "aliases": [
      "hf",
      "hugging-face",
      "huggingface-hub"
    ],
    "plugin": "huggingface",
    "apiMode": "chat_completions",
    "url": "https://huggingface.co/settings/tokens",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "kilocode",
    "name": "Kilo Code",
    "baseUrl": "https://api.kilo.ai/api/gateway",
    "envKeys": [
      "KILOCODE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "kilo-code",
      "kilo",
      "kilo-gateway"
    ],
    "plugin": "kilocode",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "kimi-coding",
    "name": "Kimi / Moonshot",
    "baseUrl": "https://api.moonshot.ai/v1",
    "envKeys": [
      "KIMI_API_KEY",
      "KIMI_CODING_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "kimi",
      "moonshot",
      "kimi-for-coding"
    ],
    "plugin": "kimi-coding",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false
  },
  {
    "id": "kimi-coding-cn",
    "name": "Kimi / Moonshot (China)",
    "baseUrl": "https://api.moonshot.cn/v1",
    "envKeys": [
      "KIMI_CN_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "kimi-cn",
      "moonshot-cn"
    ],
    "plugin": "kimi-coding",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false
  },
  {
    "id": "lmstudio",
    "name": "LM Studio",
    "baseUrl": "http://127.0.0.1:1234/v1",
    "envKeys": [
      "LM_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [],
    "plugin": "lmstudio",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false
  },
  {
    "id": "meta-ai",
    "name": "Meta Model API",
    "baseUrl": "https://api.meta.ai/v1",
    "envKeys": [
      "MODEL_API_KEY",
      "META_API_KEY",
      "META_MODEL_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "meta",
      "muse",
      "muse-spark",
      "model-api",
      "msl"
    ],
    "plugin": "meta-ai",
    "apiMode": "codex_responses",
    "url": "https://developer.meta.com/ai/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "minimax",
    "name": "MiniMax",
    "baseUrl": "https://api.minimax.io/anthropic",
    "envKeys": [
      "MINIMAX_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "mini-max"
    ],
    "plugin": "minimax",
    "apiMode": "anthropic_messages",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false
  },
  {
    "id": "minimax-cn",
    "name": "MiniMax (China)",
    "baseUrl": "https://api.minimaxi.com/anthropic",
    "envKeys": [
      "MINIMAX_CN_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "minimax-china",
      "minimax_cn"
    ],
    "plugin": "minimax",
    "apiMode": "anthropic_messages",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false
  },
  {
    "id": "minimax-oauth",
    "name": "MiniMax (OAuth \u00b7 minimax.io)",
    "baseUrl": "https://api.minimax.io/anthropic",
    "envKeys": [],
    "auth": "oauth_external",
    "aliases": [
      "minimax_oauth",
      "minimax-portal",
      "minimax-global",
      "minimax-oauth-io"
    ],
    "plugin": "minimax",
    "apiMode": "anthropic_messages",
    "url": "https://api.minimax.io/",
    "hidden": false,
    "modelListing": false,
    "oauth": true
  },
  {
    "id": "nebius-token-factory",
    "name": "Nebius Token Factory",
    "baseUrl": "https://api.tokenfactory.nebius.com/v1",
    "envKeys": [
      "NEBIUS_API_KEY",
      "NEBIUS_TOKEN_FACTORY_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "nebius",
      "nebius-tokenfactory",
      "nebius-tf",
      "token-factory",
      "tokenfactory"
    ],
    "plugin": "nebius-token-factory",
    "apiMode": "chat_completions",
    "url": "https://tokenfactory.nebius.com/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "nous",
    "name": "Nous Portal",
    "baseUrl": "https://inference-api.nousresearch.com/v1",
    "envKeys": [
      "NOUS_API_KEY"
    ],
    "auth": "oauth_device_code",
    "aliases": [
      "nous-portal",
      "nousresearch"
    ],
    "plugin": "nous",
    "apiMode": "chat_completions",
    "url": "https://nousresearch.com/",
    "hidden": false,
    "modelListing": true,
    "oauth": true
  },
  {
    "id": "novita",
    "name": "NovitaAI",
    "baseUrl": "https://api.novita.ai/openai/v1",
    "envKeys": [
      "NOVITA_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "novita-ai",
      "novitaai"
    ],
    "plugin": "novita",
    "apiMode": "chat_completions",
    "url": "https://novita.ai/settings/key-management",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "nvidia",
    "name": "NVIDIA NIM",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "envKeys": [
      "NVIDIA_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "nvidia-nim",
      "nim",
      "build-nvidia",
      "nemotron"
    ],
    "plugin": "nvidia",
    "apiMode": "chat_completions",
    "url": "https://build.nvidia.com/",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "ollama-cloud",
    "name": "Ollama Cloud",
    "baseUrl": "https://ollama.com/v1",
    "envKeys": [
      "OLLAMA_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "ollama_cloud"
    ],
    "plugin": "ollama-cloud",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "openai-api",
    "name": "OpenAI API",
    "baseUrl": "https://api.openai.com/v1",
    "envKeys": [
      "OPENAI_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [],
    "plugin": "openai-api",
    "apiMode": "codex_responses",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "openai-codex",
    "name": "OpenAI Codex",
    "baseUrl": "https://chatgpt.com/backend-api/codex",
    "envKeys": [],
    "auth": "oauth_external",
    "aliases": [
      "codex",
      "openai_codex"
    ],
    "plugin": "openai-codex",
    "apiMode": "codex_responses",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true,
    "oauth": true
  },
  {
    "id": "opencode-go",
    "name": "OpenCode Go",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "envKeys": [
      "OPENCODE_GO_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "opencode_go",
      "go",
      "opencode-go-sub"
    ],
    "plugin": "opencode-zen",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "opencode-zen",
    "name": "OpenCode Zen",
    "baseUrl": "https://opencode.ai/zen/v1",
    "envKeys": [
      "OPENCODE_ZEN_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "opencode",
      "opencode_zen",
      "zen"
    ],
    "plugin": "opencode-zen",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "envKeys": [
      "OPENROUTER_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "or"
    ],
    "plugin": "openrouter",
    "apiMode": "chat_completions",
    "url": "https://openrouter.ai/keys",
    "hidden": false,
    "modelListing": true,
    "oauth": true
  },
  {
    "id": "qwen-oauth",
    "name": "Qwen OAuth",
    "baseUrl": "https://portal.qwen.ai/v1",
    "envKeys": [
      "QWEN_API_KEY"
    ],
    "auth": "oauth_external",
    "aliases": [
      "qwen",
      "qwen-portal",
      "qwen-cli"
    ],
    "plugin": "qwen-oauth",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true,
    "oauth": true
  },
  {
    "id": "router",
    "name": "Ramp Router",
    "baseUrl": "https://api.router.com/v1",
    "envKeys": [
      "RAMP_ROUTER_API_KEY",
      "ROUTER_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "ramp-router",
      "ramp",
      "router.com"
    ],
    "plugin": "router",
    "apiMode": "codex_responses",
    "url": "https://app.router.com/keys",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "solstice",
    "name": "Solstice",
    "baseUrl": "https://generativelanguage.googleapis.com/v1alpha",
    "envKeys": [],
    "auth": "oauth_external",
    "aliases": [
      "solstice-oauth"
    ],
    "plugin": "solstice",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": true,
    "modelListing": false,
    "setupHint": "Hidden upstream provider; not an official default connection option.",
    "oauth": true
  },
  {
    "id": "stepfun",
    "name": "StepFun Step Plan",
    "baseUrl": "https://api.stepfun.ai/step_plan/v1",
    "envKeys": [
      "STEPFUN_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "step",
      "stepfun-coding-plan"
    ],
    "plugin": "stepfun",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "tencent-tokenhub",
    "name": "Tencent TokenHub",
    "baseUrl": "https://tokenhub.tencentmaas.com/v1",
    "envKeys": [
      "TOKENHUB_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [],
    "plugin": "tencent-tokenhub",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "tencent-tokenplan",
    "name": "Tencent TokenPlan",
    "baseUrl": "https://api.lkeap.cloud.tencent.com/plan/anthropic",
    "envKeys": [
      "TOKENPLAN_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [],
    "plugin": "tencent-tokenplan",
    "apiMode": "anthropic_messages",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "upstage",
    "name": "Upstage Solar",
    "baseUrl": "https://api.upstage.ai/v1",
    "envKeys": [
      "UPSTAGE_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "solar"
    ],
    "plugin": "upstage",
    "apiMode": "chat_completions",
    "url": "https://console.upstage.ai/api-keys",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "vertex",
    "name": "Google Vertex AI",
    "baseUrl": "",
    "envKeys": [],
    "auth": "vertex",
    "aliases": [
      "google-vertex",
      "vertex-ai",
      "gcp-vertex",
      "vertexai"
    ],
    "plugin": "vertex",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": false,
    "setupHint": "Configure with hermes model first; this desktop cannot provision cloud SDK credentials or deployment settings."
  },
  {
    "id": "xai",
    "name": "xAI",
    "baseUrl": "https://api.x.ai/v1",
    "envKeys": [
      "XAI_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "grok",
      "x-ai",
      "x.ai"
    ],
    "plugin": "xai",
    "apiMode": "codex_responses",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "xai-oauth",
    "name": "xAI Grok OAuth (SuperGrok / Premium+)",
    "baseUrl": "https://api.x.ai/v1",
    "envKeys": [],
    "auth": "oauth_external",
    "aliases": [],
    "plugin": "xai-oauth",
    "apiMode": "codex_responses",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true,
    "oauth": true
  },
  {
    "id": "xiaomi",
    "name": "Xiaomi MiMo",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "envKeys": [
      "XIAOMI_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "mimo",
      "xiaomi-mimo"
    ],
    "plugin": "xiaomi",
    "apiMode": "chat_completions",
    "url": "https://hermes-agent.nousresearch.com/docs/integrations/providers",
    "hidden": false,
    "modelListing": true
  },
  {
    "id": "zai",
    "name": "Z.AI / GLM",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "envKeys": [
      "GLM_API_KEY",
      "ZAI_API_KEY",
      "Z_AI_API_KEY"
    ],
    "auth": "api_key",
    "aliases": [
      "glm",
      "z-ai",
      "z.ai",
      "zhipu"
    ],
    "plugin": "zai",
    "apiMode": "chat_completions",
    "url": "https://z.ai/",
    "hidden": false,
    "modelListing": true
  }
];
export const OFFICIAL_DEFAULT_PROVIDERS = OFFICIAL_PROVIDERS.filter(p => !p.hidden);
export function officialProvider(id: string): OfficialProvider | undefined {
  const key = id.trim().toLowerCase();
  return OFFICIAL_PROVIDERS.find(p => p.id === key) ?? OFFICIAL_PROVIDERS.find(p => p.aliases.includes(key));
}
