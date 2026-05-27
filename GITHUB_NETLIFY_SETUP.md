# GitHub + Netlify

Este projeto já está pronto para deploy contínuo pela Netlify.

## 1. Criar repositório no GitHub

Crie um repositório chamado:

```text
leste-studio
```

Conta:

```text
brunaribeiromarcas
```

Recomendado:

- Público ou privado: como preferir.
- Não precisa criar README, `.gitignore` ou licença pelo GitHub, porque este projeto já contém esses arquivos.

URL esperada:

```text
https://github.com/brunaribeiromarcas/leste-studio
```

## 2. Subir o código

Na pasta deste projeto, rode:

```powershell
git remote add origin https://github.com/brunaribeiromarcas/leste-studio.git
git push -u origin main
```

## 3. Conectar na Netlify

Projeto Netlify criado:

```text
leste-studio
```

URL do painel:

```text
https://app.netlify.com/projects/leste-studio
```

No painel da Netlify:

1. Conecte o projeto ao repositório `brunaribeiromarcas/leste-studio`.
2. Use estas configurações:

```text
Publish directory: public
Functions directory: netlify/functions
Build command: npm install
```

As variáveis da DeepSeek já foram configuradas no projeto Netlify.

## 4. URL esperada

Depois do primeiro deploy:

```text
https://leste-studio.netlify.app
```
