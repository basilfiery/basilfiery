# BasilFiery

Sistema de pedidos pelo tablet na mesa, para vários restaurantes.

| Endereço | O que é | Quem usa |
|---|---|---|
| `/` | Site de vendas | Visitantes |
| `/login` | Login | Equipe dos restaurantes |
| `/mesa/<código>` | Cardápio no tablet da mesa | Cliente do restaurante |
| `/painel` | Pedidos ao vivo, mesas, cardápio, estoque, equipe, impressora | Dono, gerente, caixa |
| `/garcom` | Pedidos e chamados no celular, com notificação | Garçom |
| `/plataforma` | Cadastro dos restaurantes clientes | Você (administrador) |

## Tecnologia

- **Front-end:** React + Vite + TypeScript, publicado na Vercel.
- **Back-end:** Supabase (projeto `bceeeeielhqbtdiaiypi`): banco, login, tempo real e storage.
  - `supabase/migrations/`: tabelas, regras de acesso e dados de demonstração.
  - `supabase/functions/notificar`: envia as notificações push.
  - `supabase/functions/gestao`: cria restaurantes e logins da equipe.

## Rodar no computador

```
npm install
npm run dev
```

Abre em http://localhost:5173.

## Publicar uma mudança

```
git add .
git commit -m "descrição da mudança"
git push
```

A Vercel publica sozinha em cerca de 1 minuto.

## Atualizar o banco ou as funções

Só é necessário quando os arquivos em `supabase/` mudarem:

```
npx supabase db push
npx supabase functions deploy --use-api
```

## Programa para Windows (`desktop/`)

Abre o sistema online (mesmos dados do site) e imprime direto na térmica, fica no ícone perto do relógio e inicia com o Windows.
Só precisa gerar de novo se mudar algo dentro de `desktop/`; mudanças no site aparecem sozinhas no programa.

```
cd desktop
npm install
npm run instalador
```

O instalador sai em `desktop/dist/BasilFiery-Instalador.exe`.

## Onde editar

- **Preços dos planos e WhatsApp de vendas:** `src/config/site.ts`
- **Textos do site de vendas:** `src/paginas/site/Site.tsx`
"# basilfiery" 
