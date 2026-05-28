# Leste Studio

App web da Universidade do Leste para gerar Manual da Instrutora, Slides e Apostila do Aluno com apoio de IA.

## Publicacao na Netlify

A pasta publicada e `public`.

As funcoes serverless ficam em `netlify/functions` e expõem as rotas:

- `/api/health`
- `/api/deepseek-test`
- `/api/generate`

## Variaveis de ambiente

Configure estas variaveis no projeto Netlify:

```text
DEEPSEEK_API_KEY
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=45000
```

## Arquivos principais

- `public/index.html`: interface principal do Leste Studio.
- `public/studio.css`: identidade visual institucional.
- `public/studio.js`: fluxo do app, geracao, revisao e exportacao.
- `public/assets/logo-universidade-do-leste.jpeg`: logo oficial.
- `netlify/functions/deepseek.mts`: ponte segura com a API da DeepSeek.
- `netlify.toml`: configuracao de publicacao da Netlify.

## Observacao

O app mantem uma geracao local de emergencia caso a API esteja indisponivel.
