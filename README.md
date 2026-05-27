# Leste Studio

App web local da Universidade do Leste para gerar Manual da Instrutora, Slides e Apostila do Aluno com apoio de IA.

## Como rodar

Opção mais simples: abra `rodar-leste-studio.cmd`.

Ou use o servidor local manualmente para proteger a chave da API:

```powershell
node server.js
```

Depois abra:

```text
http://localhost:5177/
```

## IA

A integração usa DeepSeek V4 Flash via endpoint seguro no servidor local. A chave fica em `.env`, que está ignorado pelo Git.
Use `.env.example` como referência caso precise configurar outra máquina.

Variáveis usadas:

```text
DEEPSEEK_API_KEY
DEEPSEEK_MODEL
DEEPSEEK_BASE_URL
DEEPSEEK_TIMEOUT_MS
PORT
```

## Teste da IA

Depois de abrir o app, use o botão `Testar` no bloco da IA. Ele verifica a lista de modelos e faz uma geração mínima
para identificar se o problema está na chave, saldo, modelo, limite de uso ou conexão com a DeepSeek.

## Arquivos principais

- `studio.html`: interface principal do Leste Studio.
- `studio.css`: identidade visual institucional.
- `studio.js`: fluxo do app, geração, revisão e exportação.
- `server.js`: servidor local e ponte segura com a API DeepSeek.
- `assets/logo-universidade-do-leste.jpeg`: logo oficial.

## Observação

O app mantém uma geração local de emergência caso a API esteja indisponível.

## Publicação na Netlify

A pasta publicada é `public`. A integração com a DeepSeek roda na Function `netlify/functions/deepseek.mts`,
expondo as rotas `/api/health`, `/api/deepseek-test` e `/api/generate`.

Configure estas variáveis no projeto Netlify:

```text
DEEPSEEK_API_KEY
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=45000
```
